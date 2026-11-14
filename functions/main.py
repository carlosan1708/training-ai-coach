"""
Firebase Cloud Functions entry point — Python + LangGraph.
"""

import json
import re
import smtplib
from datetime import timedelta
from email.message import EmailMessage

import firebase_admin
from firebase_admin import firestore as fs
from firebase_functions import https_fn, firestore_fn, options
from google.cloud.firestore_v1.base_query import FieldFilter
from firebase_functions.params import StringParam
from langchain_core.messages import HumanMessage, AIMessage

from agents.coordinator import build_graph
from lib.llm import content_text as _content_text
from lib.openai_client import make_llm, AI_RUNTIME_SERVICE_ACCOUNT, set_ai_user, ai_user_scope
from lib.load_basis import LOAD_RULES, load_facts, read_training_load_context, generated_convention, valid_basis
from lib.access import require_approved
from lib.measurements import comparable_weight_series, local_today, workout_rollup
from lib.qa_runtime import qa_runtime_options
from lib.qa_manual_chat import qa_manual_chat_scope

# Set before importing access/usage decorators so every function uses the
# configured environment identity, including notifications and schedulers.
options.set_global_options(service_account=AI_RUNTIME_SERVICE_ACCOUNT, **qa_runtime_options())

# ─── Helpers ──────────────────────────────────────────────────────────────────

def _invoke_llm(llm, messages):
    """Invoke LLM, converting quota errors to a proper HttpsError."""
    try:
        return llm.invoke(messages)
    except Exception as e:
        err_str = str(e)
        if "429" in err_str or "RESOURCE_EXHAUSTED" in err_str or "quota" in err_str.lower():
            raise https_fn.HttpsError(
                code=https_fn.FunctionsErrorCode.RESOURCE_EXHAUSTED,
                message="OpenAI API quota is unavailable. Try again later.",
            )
        raise

# ─── Firebase init ────────────────────────────────────────────────────────────
firebase_admin.initialize_app()

# ─── Secrets & params ─────────────────────────────────────────────────────────
# All AI functions use a dedicated runtime identity and short-lived OpenAI WIF.
AI_MEMORY = options.MemoryOption.MB_512

# Email notifications (signup requests). Credentials are secrets; host/port/
# recipient are plain params so they can be set without redeploying secrets.
from access_api import APP_ENV, SMTP_USER, SMTP_PASSWORD, SMTP_HOST, SMTP_PORT
ADMIN_EMAIL = StringParam("ADMIN_EMAIL", default="")  # where notifications go


# ─── chat ─────────────────────────────────────────────────────────────────────

@https_fn.on_call(memory=AI_MEMORY, service_account=AI_RUNTIME_SERVICE_ACCOUNT, timeout_sec=300)
def chat(req: https_fn.CallableRequest) -> dict:
    uid = require_approved(req)
    data = req.data or {}
    from lib.chat_memory import read_memory, delete_memory, forget_command, apply_updates
    if isinstance(data, dict) and isinstance(data.get("action"), str) and data.get("action") in {"memory_get", "memory_delete"}:
        db = fs.client()
        if data["action"] == "memory_get":
            return read_memory(db, uid)
        return delete_memory(db, uid, revision=data.get("expectedRevision"), identifier=data.get("id"), all_facts=data.get("all", False))
    if not isinstance(data, dict) or not isinstance(data.get("message"), str):
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.INVALID_ARGUMENT, "message is required.")
    message = data["message"].strip()
    session_id = data.get("sessionId") or ""
    if not message or len(message) > 20000 or not isinstance(session_id, str) or len(session_id) > 160 or "/" in session_id:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message="message is required.",
        )

    db = fs.client()
    try:
        chat_memory = read_memory(db, uid)
    except Exception:
        chat_memory = None  # A read outage must never overwrite unknown memory.
    if chat_memory is not None:
        forgotten = forget_command(db, uid, message, chat_memory)
        if forgotten is not None:
            spanish = bool(re.search(r"olvida|borra|elimina|recuerda", message, re.I))
            return {"reply": ("He olvidado los datos que elegiste." if spanish else "I removed the memories you selected.") if forgotten else
                    ("Elige el recuerdo en la lista de memoria para olvidarlo." if spanish else "Choose the fact in your memory list so I can forget the right one."),
                    "memory_status": "saved" if forgotten else "unchanged"}

    # ── Profile ───────────────────────────────────────────────────────────────
    profile_snap = db.document(f"users/{uid}/profile/data").get()
    user_profile = profile_snap.to_dict() if profile_snap.exists else {}

    # ── Active meal plan ──────────────────────────────────────────────────────
    active_meal_plan = {}
    try:
        plans_snap = (
            db.collection(f"users/{uid}/meal_plans")
            .where(filter=FieldFilter("active", "==", True))
            .limit(1)
            .get()
        )
        if plans_snap:
            plan_data = plans_snap[0].to_dict() or {}
            active_meal_plan = plan_data.get("extracted_content") or {}
    except Exception:
        pass  # non-fatal — chat works without meal plan context

    from measurement_api import measurement_context
    progress_context = measurement_context(uid, db)
    progress_context["training_loads"] = read_training_load_context(db, uid)

    # ── Recent logs (last 7 days) ─────────────────────────────────────────────
    recent_logs = []
    try:
        today = local_today()
        for i in range(7):
            day = (today - timedelta(days=i)).isoformat()
            log_snap = db.document(f"users/{uid}/logs/{day}").get()
            if log_snap.exists:
                log_data = log_snap.to_dict() or {}
                log_data["date"] = day
                recent_logs.append(log_data)
    except Exception:
        pass  # non-fatal — chat works without log context

    # ── Chat history ──────────────────────────────────────────────────────────
    history: list = []
    if session_id:
        session_snap = db.document(f"users/{uid}/chat_sessions/{session_id}").get()
        if session_snap.exists:
            raw_messages = (session_snap.to_dict() or {}).get("messages", [])[-10:]
            for m in raw_messages:
                if m.get("role") == "user":
                    history.append(HumanMessage(content=m["content"]))
                else:
                    history.append(AIMessage(content=m["content"]))

    history.append(HumanMessage(content=message))

    graph = build_graph()
    # Only this authenticated, validated manual chat can receive the separate
    # QA chat allowance. Both contexts unwind even when the graph/provider fails.
    with ai_user_scope(uid), qa_manual_chat_scope(uid):
        result = graph.invoke({
            "messages": history,
            "user_profile": user_profile,
            "active_meal_plan": active_meal_plan,
            "recent_logs": recent_logs,
            "progress_context": progress_context,
            "chat_memory": chat_memory or {"revision": 0, "facts": []},
            "current_user_message": message,
            "memory_updates": [],
            "intent": None,
        })

    ai_messages = [m for m in result["messages"] if isinstance(m, AIMessage)]
    reply = _content_text(ai_messages[-1]) if ai_messages else "Sorry, I couldn't generate a response."

    memory_status = "unavailable" if chat_memory is None else "unchanged"
    if chat_memory is not None:
        try:
            message_id = data.get("messageId")
            if not isinstance(message_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{8,160}", message_id): message_id = None
            memory_status = apply_updates(db, uid, chat_memory, result.get("memory_updates"), message, session_id, message_id)
        except Exception:
            memory_status = "unavailable"
    return {"reply": reply, "memory_status": memory_status}


# ─── parse_exercise_photo ─────────────────────────────────────────────────────

@https_fn.on_call(memory=AI_MEMORY, service_account=AI_RUNTIME_SERVICE_ACCOUNT, timeout_sec=300)
def parse_exercise_photo(req: https_fn.CallableRequest) -> dict:
    """
    Receives a base64-encoded image, runs OpenAI vision on it,
    and returns a structured list of exercises extracted from the photo.
    """
    set_ai_user(require_approved(req))

    data = req.data or {}
    image_b64: str = data.get("imageData", "")
    mime_type: str = data.get("mimeType", "image/jpeg")

    if not image_b64:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message="imageData is required.",
        )

    llm = make_llm("extraction")

    message = HumanMessage(content=[
        {
            "type": "image_url",
            "image_url": {"url": f"data:{mime_type};base64,{image_b64}"},
        },
        {
            "type": "text",
            "text": (
                "You are a fitness assistant. Extract all exercise data from this image. "
                "The image may show a whiteboard, handwritten notes, a gym app, or a workout log. "
                "Return ONLY a valid JSON array — no markdown, no explanation — like:\n"
                '[{"exercise":"Bench Press","sets":3,"reps":10,"weight_kg":80.0,"notes":""}]\n'
                "Rules:\n"
                "- If weights are in lbs, convert to kg (divide by 2.205 and round to 1 decimal).\n"
                "- For bodyweight exercises set weight_kg to 0.\n"
                "- If reps vary per set (e.g. 10/8/6), use the first value for reps and put the rest in notes.\n"
                "- If no exercise data is visible, return []."
            ),
        },
    ])

    response = _invoke_llm(llm, [message])
    text = _content_text(response).strip()

    # Strip markdown code fences if the model wraps the output
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)

    match = re.search(r"\[.*\]", text, re.DOTALL)
    if match:
        try:
            exercises = json.loads(match.group())
        except json.JSONDecodeError:
            exercises = []
    else:
        exercises = []

    return {"exercises": exercises}


# ─── parse_body_composition_report ───────────────────────────────────────────

@https_fn.on_call(memory=AI_MEMORY, service_account=AI_RUNTIME_SERVICE_ACCOUNT, timeout_sec=300)
def parse_body_composition_report(req: https_fn.CallableRequest) -> dict:
    """
    Extracts structured data from a body composition analyzer report
    (Fitdays, InBody, Tanita, Withings, etc.) provided as a screenshot or photo.

    Complements manual tape measurements — both are stored in the daily log
    for AI/RAG ingestion.
    """
    set_ai_user(require_approved(req))

    data = req.data or {}
    image_b64: str = data.get("imageData", "")
    mime_type: str = data.get("mimeType", "image/jpeg")

    if not image_b64:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message="imageData is required.",
        )

    llm = make_llm("extraction")

    message = HumanMessage(content=[
        {
            "type": "image_url",
            "image_url": {"url": f"data:{mime_type};base64,{image_b64}"},
        },
        {
            "type": "text",
            "text": (
                "You are a body composition analysis expert. "
                "Extract ALL data from this body composition report. "
                "The document may be in English or Spanish. "
                "There are TWO types — detect which type it is and extract accordingly:\n\n"

                "TYPE 1 — BIA SCALE REPORT (Fitdays, InBody, Tanita, Withings, Xiaomi, etc.):\n"
                '{"source_app":"Fitdays","report_date":"2025-12-07","weight_kg":82.6,'
                '"body_fat_pct":21.9,"body_fat_kg":18.1,"skeletal_muscle_kg":36.2,'
                '"skeletal_muscle_pct":43.8,"bone_mass_kg":3.2,"body_water_pct":57.1,'
                '"protein_kg":12.3,"bmi":24.8,"visceral_fat_level":8,"body_score":79,'
                '"metabolic_age":null,'
                '"segmental_fat":{"left_arm_kg":0.7,"right_arm_kg":0.8,"left_leg_kg":5.2,'
                '"right_leg_kg":5.3,"trunk_kg":22.7},'
                '"segmental_muscle":{"left_arm_kg":3.1,"right_arm_kg":3.2,"left_leg_kg":9.8,'
                '"right_leg_kg":9.7,"trunk_kg":27.0},'
                '"bia":{"resistance_50khz":447,"reactance_50khz":57},'
                '"weight_control":{"recommended_weight_kg":80.2,"fat_to_lose_kg":1.9,'
                '"muscle_to_gain_kg":0.5}}\n\n'

                "TYPE 2 — ISAK / ANTHROPOMETRIC REPORT (Holway, ISAK, skinfold-based, "
                "often from Excel/lab — may be in Spanish with words like Pliegue, Perimetro, "
                "Somatotipo, Composicion Corporal):\n"
                '{"source_app":"Holway/ISAK","report_date":"2026-01-05",'
                '"weight_kg":61.6,"height_cm":163.1,"bmi":23.2,'
                '"fat_method":"Jackson/Pollock","body_fat_pct":12.4,"body_fat_kg":7.6,'
                '"bone_mass_pct":15.0,"bone_mass_kg":9.2,'
                '"residual_mass_pct":24.1,"residual_mass_kg":14.8,'
                '"muscle_mass_pct":48.5,"muscle_mass_kg":29.9,"lean_mass_kg":55.6,'
                '"sum_6_skinfolds_mm":68.5,'
                '"skinfolds":{"triceps_mm":8.5,"subscapular_mm":11.0,"pectoral_mm":10.0,'
                '"iliac_crest_mm":23.0,"supraspinale_mm":12.0,"abdominal_mm":19.0,'
                '"medial_thigh_mm":11.0,"medial_calf_mm":7.0,"axillary_mm":11.0},'
                '"girths":{"relaxed_arm_cm":32.0,"tensed_arm_cm":33.1,"waist_cm":76.0,'
                '"hip_cm":93.0,"calf_cm":35.5},'
                '"bone_breadths":{"humerus_cm":6.7,"femur_cm":9.4},'
                '"somatotype":{"endomorph":3.4,"mesomorph":6.2,"ectomorph":1.7,'
                '"dominant":"Mesomorph"},'
                '"arm_muscle_area_mm2":68}\n\n'

                "Rules:\n"
                "- Detect the report type and extract ALL numbers visible.\n"
                "- Omit fields not present in the document.\n"
                "- The document may be in Spanish: Pliegue=Skinfold, Perimetro=Girth, "
                "Peso=Weight, Talla=Height, Grasa=Fat, Musculo=Muscle, Oseo=Bone.\n"
                "- Convert lbs → kg if needed (divide by 2.205, round to 1 decimal).\n"
                "- Add a \"summary\" field: 2-3 sentences in the document's language describing "
                "the key findings (body fat %, muscle mass, notable results, recommendations).\n"
                "- Add a \"report_date\" field in ISO format YYYY-MM-DD if a measurement date is visible.\n"
                "- If this is not a body composition report, return "
                '{"error":"not a body composition report"}.'
            ),
        },
    ])

    response = _invoke_llm(llm, [message])
    text = _content_text(response).strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)

    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        try:
            report = json.loads(match.group())
        except json.JSONDecodeError:
            report = {"error": "parse_failed"}
    else:
        report = {"error": "no_data"}

    summary = report.pop("summary", None) if isinstance(report, dict) else None
    return {"report": report, "summary": summary}


# ─── Workout routine helpers ─────────────────────────────────────────────────

def _profile_summary(profile: dict) -> str:
    """Compact one-block summary of the user profile for workout prompts."""
    fields = [
        ("Name", profile.get("name")),
        ("Age", profile.get("age")),
        ("Sex", profile.get("biological_sex")),
        ("Height cm", profile.get("height_cm")),
        ("Goal weight kg", profile.get("goal_weight_kg")),
        ("Training goal", profile.get("training_goal")),
        ("Equipment", profile.get("equipment")),
        ("Training days/week", profile.get("training_days_per_week")),
        ("Session length min", profile.get("session_length_min")),
        ("Movement restrictions", profile.get("movement_restrictions")),
        ("Health notes", profile.get("health_notes")),
    ]
    lines = [f"- {k}: {v}" for k, v in fields if v not in (None, "", [])]
    return "\n".join(lines) if lines else "- (no profile data)"


def _extract_json(text: str):
    """Strip code fences and parse the first JSON object/array in the text."""
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    match = re.search(r"[\[{].*[\]}]", text, re.DOTALL)
    if not match:
        return None
    try:
        return json.loads(match.group())
    except json.JSONDecodeError:
        return None


# ─── generate_routine ────────────────────────────────────────────────────────

@https_fn.on_call(memory=AI_MEMORY, service_account=AI_RUNTIME_SERVICE_ACCOUNT, timeout_sec=300)
def generate_routine(req: https_fn.CallableRequest) -> dict:
    """
    Generates a structured workout routine from the user's profile plus an
    optional focus/notes prompt. Returns a routine the client can save.
    """
    set_ai_user(require_approved(req))

    uid = req.auth.uid
    data = req.data or {}
    focus: str = (data.get("focus") or "").strip()
    notes: str = (data.get("notes") or "").strip()

    db = fs.client()
    profile_snap = db.document(f"users/{uid}/profile/data").get()
    profile = profile_snap.to_dict() if profile_snap.exists else {}

    response_language = profile.get("response_language") or "en"

    prompt = (
        "You are an expert strength & conditioning coach. Design ONE workout "
        "routine (a single session template the user will repeat) for this user.\n\n"
        f"User profile:\n{_profile_summary(profile)}\n\n"
        f"Requested focus: {focus or 'coach decides based on profile'}\n"
        f"Extra notes: {notes or 'none'}\n\n"
        "Return ONLY a valid JSON object — no markdown, no explanation — like:\n"
        '{"name":"Upper Body Strength A",'
        '"description":"One short sentence describing the routine.",'
        '"exercises":[{"name":"Barbell Bench Press","muscle_group":"chest",'
        '"sets":4,"reps":8,"weight_kg":40,"rest_sec":90,'
        '"notes":"short form cue or intensity guidance"}]}\n'
        "Rules:\n"
        "- 5 to 8 exercises, ordered compound-first.\n"
        + LOAD_RULES + "\nSpecify load_basis for every exercise: per_dumbbell, total, machine_display or per_side.\n"
        "- Use standard, widely-known English exercise names (e.g. 'Barbell Squat', "
        "'Lat Pulldown', 'Dumbbell Shoulder Press') so they can be matched against "
        "an exercise-demo database. Keep names in English even if other text is not.\n"
        "- weight_kg is a conservative starting working weight; use 0 for "
        "bodyweight exercises. If you cannot estimate, use null.\n"
        "- Respect the user's equipment, restrictions, and session length.\n"
        f"- Write 'description' and 'notes' in language: {response_language}.\n"
    )

    llm = make_llm("general")
    response = _invoke_llm(llm, [HumanMessage(content=prompt)])
    routine = _extract_json(_content_text(response))

    if not isinstance(routine, dict) or not routine.get("exercises"):
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message="Could not generate a routine. Please try again.",
        )

    routine["exercises"] = [generated_convention(ex) for ex in routine["exercises"]]
    return {"routine": routine}


# ─── plan_workout_session ────────────────────────────────────────────────────

@https_fn.on_call(memory=AI_MEMORY, service_account=AI_RUNTIME_SERVICE_ACCOUNT, timeout_sec=300)
def plan_workout_session(req: https_fn.CallableRequest) -> dict:
    """
    Given a routine and its recent session history, returns AI-adjusted
    targets (weight / reps / sets) for today's session, or one explicitly
    requested exercise alternative through the same guarded AI provider.
    """
    set_ai_user(require_approved(req))

    uid = req.auth.uid
    data = req.data or {}
    if not isinstance(data, dict):
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message="A workout request is required.",
        )
    if "substitution" in data:
        from lib.exercise_substitution import (
            validate_substitution_request, build_substitution_prompt, validate_substitution_response,
        )
        try:
            substitution = validate_substitution_request(data["substitution"])
        except ValueError as error:
            raise https_fn.HttpsError(
                code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT, message=str(error),
            ) from error
        db = fs.client()
        profile_snap = db.document(f"users/{uid}/profile/data").get()
        profile = (profile_snap.to_dict() if profile_snap.exists else {}) or {}
        prompt = build_substitution_prompt(substitution, profile)
        response = _invoke_llm(make_llm("general"), [HumanMessage(content=prompt)])
        try:
            return validate_substitution_response(_extract_json(_content_text(response)), substitution)
        except ValueError as error:
            raise https_fn.HttpsError(
                code=https_fn.FunctionsErrorCode.INTERNAL,
                message="Could not suggest an exercise alternative. Please try again.",
            ) from error
    routine: dict = data.get("routine") or {}
    recent_sessions: list = data.get("recentSessions") or []

    if not routine.get("exercises"):
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message="routine with exercises is required.",
        )

    db = fs.client()
    profile_snap = db.document(f"users/{uid}/profile/data").get()
    profile = profile_snap.to_dict() if profile_snap.exists else {}
    response_language = profile.get("response_language") or "en"

    # Recent readiness signals: energy / weight / notes from the last 7 days
    readiness = []
    try:
        today = local_today()
        for i in range(7):
            day = (today - timedelta(days=i)).isoformat()
            snap = db.document(f"users/{uid}/logs/{day}").get()
            if snap.exists:
                log = snap.to_dict() or {}
                entry = {"date": day}
                for key in ("energy", "weight_kg", "notes"):
                    if log.get(key) not in (None, ""):
                        entry[key] = log[key]
                if len(entry) > 1:
                    readiness.append(entry)
    except Exception:
        pass  # non-fatal — planning works without readiness data

    # Compact the session history: keep only what the coach needs
    history = []
    for s in recent_sessions[:6]:
        history.append({
            "date": s.get("date"),
            "exercises": [
                {
                    "name": e.get("name"), **load_facts(e),
                    "sets": [
                        {"reps": st.get("reps"), "weight_kg": st.get("weight_kg")}
                        for st in (e.get("sets") or []) if st.get("done")
                    ],
                }
                for e in (s.get("exercises") or [])
            ],
        })

    routine_exercises = [
        {
            "name": e.get("name"), **load_facts(e),
            "sets": e.get("sets"),
            "reps": e.get("reps"),
            "weight_kg": e.get("weight_kg"),
        }
        for e in routine["exercises"]
    ]

    prompt = (
        "You are an expert strength coach planning TODAY's session for this user.\n\n"
        f"User profile:\n{_profile_summary(profile)}\n\n"
        f"Routine template:\n{json.dumps(routine_exercises, ensure_ascii=False)}\n\n"
        f"Recent sessions of this routine (newest first, completed sets only):\n"
        f"{json.dumps(history, ensure_ascii=False) if history else 'none — this is the first session'}\n\n"
        f"Recent daily readiness logs (energy is 1-5):\n"
        f"{json.dumps(readiness, ensure_ascii=False) if readiness else 'none'}\n\n"
        + LOAD_RULES + "\nApply progressive overload only within the same confirmed load basis:\n"
        "- If the user completed all target sets/reps last time, increase weight "
        "(~2.5% upper body, ~5% lower body, minimum sensible plate jump) OR add a rep.\n"
        "- If they missed reps, hold or slightly reduce the load.\n"
        "- If recent energy is low (<=2) or notes mention fatigue/soreness/illness, "
        "reduce volume or load and say why.\n"
        "- For bodyweight/duration exercises progress reps or sets instead of weight.\n"
        "- Round weights to practical increments (1.25 / 2.5 kg).\n"
        "- PLATEAU CHECK (important): compare each exercise's top working weight across "
        "the session history dates. If it has not increased over a span of 14 days or "
        "more, explicitly tell the user in 'insight' that the lift has stalled for ~2 "
        "weeks, and change strategy for that exercise instead of repeating it: pick ONE "
        "of (a) deload ~10% and rebuild, (b) change the rep scheme (e.g. 4x8 -> 5x5), or "
        "(c) suggest a variation — and set that exercise's 'note' accordingly with "
        "change='decrease' for a deload or 'hold' otherwise.\n\n"
        "Return ONLY a valid JSON object — no markdown — like:\n"
        '{"insight":"2-3 sentence coaching summary for today: overall readiness, '
        'what changed vs last session and why, and one focus point.",'
        '"exercises":[{"name":"Barbell Bench Press","sets":4,"reps":8,'
        '"weight_kg":42.5,"change":"increase","note":"very short reason, max 10 words"}]}\n'
        "Rules:\n"
        "- Include EVERY exercise from the routine template, same names, same order.\n"
        "- change must be one of: increase, hold, decrease.\n"
        f"- Write 'insight' and 'note' in language: {response_language}.\n"
    )

    llm = make_llm("general")
    response = _invoke_llm(llm, [HumanMessage(content=prompt)])
    plan = _extract_json(_content_text(response))

    if not isinstance(plan, dict) or not plan.get("exercises"):
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INTERNAL,
            message="Could not plan the session. Please try again.",
        )

    # The model may recommend loads, but it cannot silently change their meaning.
    configured = {ex.get("name", "").casefold(): ex for ex in routine["exercises"]}
    for exercise in plan["exercises"]:
        original = configured.get(exercise.get("name", "").casefold(), {})
        proposed_basis = exercise.pop("load_basis", None)
        if valid_basis(original.get("load_basis")):
            exercise["load_basis"] = original["load_basis"]
        if (original.get("load_basis_review_required") or not valid_basis(original.get("load_basis"))
            or (proposed_basis is not None and proposed_basis != original.get("load_basis"))):
            if "weight_kg" in exercise or original.get("load_basis_review_required"): exercise["weight_kg"] = 0
            if "change" in exercise or original.get("load_basis_review_required"): exercise["change"] = "hold"
    return {"plan": plan}


# ─── Weekly AI report ────────────────────────────────────────────────────────

def _top_completed_set(exercise: dict):
    tops = [
        st.get("weight_kg") or 0
        for st in (exercise.get("sets") or [])
        if st.get("done")
    ]
    return max(tops) if tops else None


def _week_stats(uid: str, db) -> dict:
    """Accurate, locally computed numbers for the last 7 days (+ previous 7 for comparison)."""
    today = local_today()
    week_start = today - timedelta(days=6)
    prev_start = today - timedelta(days=13)

    logs = []
    day = week_start
    while day <= today:
        snap = db.document(f"users/{uid}/logs/{day.isoformat()}").get()
        if snap.exists:
            data = snap.to_dict() or {}
            data["date"] = day.isoformat()
            logs.append(data)
        day += timedelta(days=1)

    from measurement_api import load_measurement_entries
    from lib.progress_reporting import measurement_tracking_context
    from lib.weekly_reporting import current_weekly_weight_entries
    observed = load_measurement_entries(uid, db)
    weights, weight_source = comparable_weight_series(
        current_weekly_weight_entries(observed), week_start.isoformat(), today.isoformat())
    energies = [l["energy"] for l in logs if l.get("energy")]

    sessions_snap = (
        db.collection(f"users/{uid}/workout_sessions")
        .where(filter=FieldFilter("date", ">=", prev_start.isoformat()))
        .get()
    )
    completed = [
        s.to_dict() for s in sessions_snap
        if (s.to_dict() or {}).get("status") == "completed"
    ]
    this_week = [s for s in completed if week_start.isoformat() <= s.get("date", "") <= today.isoformat()]
    prev_week = [s for s in completed if s.get("date", "") < week_start.isoformat()]

    this_rollup = workout_rollup(this_week, 14, today)
    prev_rollup = workout_rollup(prev_week, 14, today)
    this_vol, prev_vol = this_rollup["total_volume_kg"], prev_rollup["total_volume_kg"]

    return {
        "week_start": week_start.isoformat(),
        "week_end": today.isoformat(),
        "sessions": len(this_week),
        "completed_sets": this_rollup["completed_sets"],
        "routines_done": sorted({s.get("routine_name") or "?" for s in this_week}),
        "total_volume_kg": round(this_vol),
        "prev_volume_kg": round(prev_vol),
        "volume_change_pct": round((this_vol - prev_vol) / prev_vol * 100) if prev_vol else None,
        "weight_start_kg": weights[0][1] if weights else None,
        "weight_end_kg": weights[-1][1] if weights else None,
        "weight_delta_kg": round(weights[-1][1] - weights[0][1], 1) if len(weights) >= 2 else None,
        "weight_day_count": len(weights),
        "weight_source": weight_source,
        "historical_measurement_sources": measurement_tracking_context(observed, today=today)["historical_sources"],
        "avg_energy": round(sum(energies) / len(energies), 1) if energies else None,
        "session_details": [
            {
                "date": s.get("date"),
                "routine": s.get("routine_name"),
                "volume_kg": workout_rollup([s], 14, today)["total_volume_kg"],
                "completed_sets": workout_rollup([s], 14, today)["completed_sets"],
                "load_conventions": [{"name": e.get("name"), **load_facts(e)} for e in (s.get("exercises") or [])],
                "top_sets": {
                    e.get("name"): _top_completed_set(e)
                    for e in (s.get("exercises") or [])
                },
            }
            for s in this_week
        ],
    }


def _generate_weekly_report(uid: str, db, stats: dict | None = None) -> dict:
    """Compute the week's stats, ask OpenAI for the narrative, store and return the report."""
    profile_snap = db.document(f"users/{uid}/profile/data").get()
    profile = profile_snap.to_dict() if profile_snap.exists else {}
    language = profile.get("response_language") or "en"

    if stats is None:
        stats = _week_stats(uid, db)

    prompt = (
        "You are the user's strength & health coach writing their weekly report.\n\n"
        f"User profile:\n{_profile_summary(profile)}\n\n"
        f"This week's data (locally computed — treat as accurate):\n"
        f"{json.dumps(stats, ensure_ascii=False)}\n\n"
        "Return ONLY a valid JSON object — no markdown — like:\n"
        '{"headline":"Your week in training",'
        '"summary":"2-3 concise sentences about useful recorded training progress and one next step.",'
        '"wins":["max 3 short bullets"],'
        '"focus_next_week":["max 3 short, actionable bullets"]}\n'
        "Rules:\n"
        "- Base every claim strictly on the provided data; never invent numbers.\n"
        + LOAD_RULES + "\n- Compare top set weights only with the same confirmed basis.\n"
        "- Always give a useful summary and at least one feasible focus, even with sparse data. Use recorded sessions, completed sets or a source-compatible weight baseline. Never say 'nothing to report', 'sin novedades', or dismiss the week because data is sparse.\n"
        "- Zero recorded sessions or missing daily logs do not establish inactivity. Describe what is recorded; do not assume the user stopped training.\n"
        "- Source names (including a former coach, clinician or report author) are historical provenance, never an ongoing dependency. Do not request another third-party or anthropometry report, a repeat assessment or a return to a named provider.\n"
        "- historical_measurement_sources are dated past context only. Anthropometric, ISAK and skinfold assessments are excluded from current weekly weight tracking; do not use them to drive current trends, forecasts or next steps.\n"
        "- Future tracking can use the user's own scale or manual measurements. Keep sources, methods and units separate; a new source starts its own baseline. Do not insist that historical sources continue.\n"
        "- Mention weight change only if weight_delta_kg is present.\n"
        "- One measurement day is only a baseline. Weight change alone never establishes fat loss, muscle gain, recomposition, fitness or goal attainment.\n"
        "- Do not mention aggregate training volume, total kilograms lifted or their percentage changes in the headline, summary, wins or focus. More tonnage across different exercises is not evidence of hypertrophy or progress. Prioritize consistency and comparable exercise-level load/repetition progress only when supported by the supplied data; otherwise give a practical next-session focus without inventing improvement. Do not list missing energy data. Recorded energy is a self-rating and does not establish recovery.\n"
        f"- Write everything in language: {language}.\n"
    )

    llm = make_llm("general")
    response = _invoke_llm(llm, [HumanMessage(content=prompt)])
    from lib.weekly_reporting import weekly_narrative
    narrative = weekly_narrative(_extract_json(_content_text(response)), stats, language)

    report = {
        "week_start": stats["week_start"],
        "week_end": stats["week_end"],
        **narrative,
        "stats": {k: v for k, v in stats.items() if k != "session_details"},
    }
    db.collection(f"users/{uid}/weekly_reports").add(
        {**report, "created_at": fs.SERVER_TIMESTAMP}
    )
    return report


@https_fn.on_call(memory=AI_MEMORY, service_account=AI_RUNTIME_SERVICE_ACCOUNT, timeout_sec=300)
def generate_weekly_report(req: https_fn.CallableRequest) -> dict:
    """Weekly report — the client calls this on login when the last report is stale."""
    set_ai_user(require_approved(req))
    return {"report": _generate_weekly_report(req.auth.uid, fs.client())}


# ─── analyze_meal_photo ───────────────────────────────────────────────────────

@https_fn.on_call(memory=AI_MEMORY, service_account=AI_RUNTIME_SERVICE_ACCOUNT, timeout_sec=300)
def analyze_meal_photo(req: https_fn.CallableRequest) -> dict:
    """
    Receives a base64-encoded photo of a meal and returns structured
    nutrition: individual food items plus total calories and macros.
    """
    set_ai_user(require_approved(req))

    data = req.data or {}
    image_b64: str = data.get("imageData", "")
    mime_type: str = data.get("mimeType", "image/jpeg")

    if not image_b64:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message="imageData is required.",
        )

    llm = make_llm("extraction")

    message = HumanMessage(content=[
        {
            "type": "image_url",
            "image_url": {"url": f"data:{mime_type};base64,{image_b64}"},
        },
        {
            "type": "text",
            "text": (
                "You are a nutrition expert. Analyse this photo of a meal and estimate "
                "its nutrition. Identify each distinct food item, estimate its portion, "
                "and give calories and macronutrients. Return ONLY a valid JSON object "
                "— no markdown, no explanation — like:\n"
                '{"name":"Grilled chicken with rice and salad",'
                '"items":[{"name":"Grilled chicken breast","portion":"150g",'
                '"calories":250,"protein_g":46,"carbs_g":0,"fat_g":6},'
                '{"name":"White rice","portion":"1 cup","calories":205,'
                '"protein_g":4,"carbs_g":45,"fat_g":0}],'
                '"total_calories":455,"total_protein_g":50,"total_carbs_g":45,'
                '"total_fat_g":6,"confidence":"medium"}\n'
                "Rules:\n"
                "- Estimate realistic portions from what's visible in the photo.\n"
                "- total_* must be the sum of the items.\n"
                "- Round all numbers to whole integers.\n"
                "- confidence is one of: low / medium / high.\n"
                "- If the image is not food, return "
                '{"error":"not a meal photo"}.'
            ),
        },
    ])

    response = _invoke_llm(llm, [message])
    meal = _extract_json(_content_text(response))

    if not isinstance(meal, dict) or meal.get("error"):
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message="Could not identify food in that photo. Try a clearer picture.",
        )

    return {"meal": meal}


# ─── Signup email notification ────────────────────────────────────────────────

@firestore_fn.on_document_created(
    document="user_status/{uid}",
    secrets=[SMTP_USER, SMTP_PASSWORD],
)
def notify_signup_request(event: firestore_fn.Event[firestore_fn.DocumentSnapshot | None]) -> None:
    """
    When a new user requests access (a user_status doc is created), email the
    admin so they can approve or reject from the /admin panel.

    Configure once:
      firebase functions:secrets:set SMTP_USER       # your Gmail address
      firebase functions:secrets:set SMTP_PASSWORD   # Gmail App Password
      firebase functions:config is NOT used — set params via .env or:
      echo "ADMIN_EMAIL=you@example.com" >> functions/.env
    If SMTP is not configured the function logs and exits without erroring.
    """
    snap = event.data
    if snap is None:
        return
    doc = snap.to_dict() or {}

    # Only notify for brand-new pending requests
    if doc.get("status") not in (None, "pending"):
        return

    if APP_ENV.value != "production":
        fs.client().collection("qa_mail").add({"kind": "signup_request", "recipient": "owner",
            "user_id": event.params.get("uid"), "created_at": fs.SERVER_TIMESTAMP})
        print("notify_signup_request: captured QA notification.")
        return

    user = SMTP_USER.value
    password = SMTP_PASSWORD.value
    recipient = ADMIN_EMAIL.value or user
    if not user or not password or not recipient:
        print("notify_signup_request: SMTP not configured — skipping email.")
        return

    display_name = doc.get("displayName") or "Unknown"
    email = doc.get("email") or "unknown"

    msg = EmailMessage()
    msg["Subject"] = f"Training AI Coach — new signup request from {display_name}"
    msg["From"] = user
    msg["To"] = recipient
    msg.set_content(
        f"A new user has requested access to Training AI Coach:\n\n"
        f"  Name:  {display_name}\n"
        f"  Email: {email}\n"
        f"  UID:   {event.params.get('uid')}\n\n"
        f"Approve or reject them in the Admin panel of the app."
    )

    try:
        with smtplib.SMTP(SMTP_HOST.value, int(SMTP_PORT.value), timeout=15) as server:
            server.starttls()
            server.login(user, password)
            server.send_message(msg)
        print("notify_signup_request: notification sent.")
    except Exception:  # Email failure must never prevent an access request.
        print("notify_signup_request: notification delivery failed.")


# ─── extract_meal_plan_content ────────────────────────────────────────────────

@https_fn.on_call(memory=AI_MEMORY, service_account=AI_RUNTIME_SERVICE_ACCOUNT, timeout_sec=300)
def extract_meal_plan_content(req: https_fn.CallableRequest) -> dict:
    """
    Extracts structured nutrition data from a meal plan image or PDF.
    Stored in Firestore for AI/RAG ingestion.
    """
    set_ai_user(require_approved(req))

    data = req.data or {}
    image_b64: str = data.get("imageData", "")
    mime_type: str = data.get("mimeType", "image/jpeg")
    text_content: str = data.get("textContent", "")

    if not image_b64 and not text_content:
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
            message="imageData or textContent is required.",
        )

    EXTRACTION_PROMPT = (
        "You are a nutrition analyst. Extract ALL meal plan data from this document. "
        "Return ONLY a valid JSON object — no markdown, no explanation — like:\n"
        '{"plan_name":"Cutting Phase","dietary_type":"cutting",'
        '"daily_calories":1800,"macros":{"protein_g":160,"carbs_g":180,"fat_g":50},'
        '"meals":[{"name":"Breakfast","time":"07:00","foods":['
        '{"name":"Oats","portion":"80g","calories":300,"protein_g":10,"carbs_g":55,"fat_g":5}'
        ']}],"notes":["Drink 3L water daily","Avoid processed foods"],'
        '"supplements":["Whey protein post-workout"],'
        '"summary":"2-3 sentence plain-language overview of the meal plan: '
        'its goal, daily calories, macro split, number of meals, and any key rules."}\n'
        "Rules:\n"
        "- Extract every meal, food item, portion, and macro visible in the document.\n"
        "- If a value is not specified, omit that field.\n"
        "- dietary_type: one of cutting / bulking / maintenance / recomp / other\n"
        "- summary: always include — write it in the same language as the document.\n"
        "- If the document is not a meal plan, return "
        '{"error":"not a meal plan"}.'
    )

    llm = make_llm("extraction")

    if text_content:
        message = HumanMessage(content=[
            {"type": "text", "text": f"{EXTRACTION_PROMPT}\n\nDocument text:\n{text_content}"},
        ])
    else:
        message = HumanMessage(content=[
            {
                "type": "image_url",
                "image_url": {"url": f"data:{mime_type};base64,{image_b64}"},
            },
            {"type": "text", "text": EXTRACTION_PROMPT},
        ])

    response = _invoke_llm(llm, [message])
    text = _content_text(response).strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)

    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        try:
            content = json.loads(match.group())
        except json.JSONDecodeError:
            content = {"error": "parse_failed"}
    else:
        content = {"error": "no_data"}

    return {"content": content}


# Imported only after Admin initialization; all endpoints share the same app.
from measurement_api import (parse_measurement_import, save_measurement_entries,
    update_measurement_entry, delete_measurement_entry, get_measurement_workspace,
    generate_progress_insights, retry_measurement_job, measurement_job_written,
    legacy_measurements_changed, legacy_body_report_changed)
from access_api import (request_access, list_people, set_access_status, create_invitation,
    resend_invitation, revoke_invitation, accept_invitation)
from usage_api import (record_usage, usage_report, usage_workout_changed,
    usage_profile_changed, usage_routine_created, usage_checkin_changed)
import usage_api as _usage_api
if hasattr(_usage_api, "usage_cleanup"):
    usage_cleanup = _usage_api.usage_cleanup
