"""Responses API adapter. Production authenticates exclusively through GCP WIF.

No API key, uploaded OpenAI file, conversation, or response state is persisted.
The SDK owns short-lived token exchange/refresh; application code never logs tokens.
"""

import base64
import json
import os
import uuid
from contextvars import ContextVar
from contextlib import contextmanager
from functools import lru_cache

from firebase_functions import https_fn
from firebase_functions.params import StringParam
from langchain_core.messages import AIMessage
from lib.qa_ai_gate import enforce_qa_ai_lease
from lib.qa_manual_chat import clear_manual_chat_scope, consume_manual_chat_permit
from lib.qa_runtime import is_exact_qa_environment

AI_RUNTIME_SERVICE_ACCOUNT = StringParam("AI_RUNTIME_SERVICE_ACCOUNT", default="")
OPENAI_IDENTITY_PROVIDER_ID = StringParam("OPENAI_IDENTITY_PROVIDER_ID", default="")
OPENAI_SERVICE_ACCOUNT_ID = StringParam("OPENAI_SERVICE_ACCOUNT_ID", default="")
OPENAI_AUDIENCE = StringParam("OPENAI_AUDIENCE", default="https://api.openai.com/v1")
OPENAI_GENERAL_MODEL = StringParam("OPENAI_GENERAL_MODEL", default="gpt-5.6-terra")
OPENAI_ANALYSIS_MODEL = StringParam("OPENAI_ANALYSIS_MODEL", default="gpt-5.6-terra")

MAX_FILE_BYTES = 10 * 1024 * 1024
IMAGE_MIME_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
_AI_USER = ContextVar("ai_user", default=None)


def set_ai_user(uid):
    clear_manual_chat_scope()
    _AI_USER.set(uid)
    return uid


@contextmanager
def ai_user_scope(uid):
    clear_manual_chat_scope()
    token = _AI_USER.set(uid)
    try:
        yield
    finally:
        clear_manual_chat_scope()
        _AI_USER.reset(token)


def _record_ai(success):
    uid = _AI_USER.get()
    if not uid:
        return
    try:
        from usage_api import safe_record_usage
        safe_record_usage(uid, "ai_succeeded" if success else "ai_failed", uuid.uuid4().hex)
    except Exception:
        pass  # Usage collection never blocks coaching.


def _param(param):
    return str(param.value or "").strip()


def mock_enabled():
    """Explicit emulators/isolated QA only; production always requires real WIF."""
    enabled = os.environ.get("AI_MOCK_ENABLED", "").lower() in {"1", "true"}
    if not enabled:
        return False
    emulator = os.environ.get("FUNCTIONS_EMULATOR", "").lower() == "true"
    emulator = emulator or bool(os.environ.get("FIRESTORE_EMULATOR_HOST"))
    project = os.environ.get("GCLOUD_PROJECT") or os.environ.get("GOOGLE_CLOUD_PROJECT", "")
    qa_project = os.environ.get("QA_FIREBASE_PROJECT_ID", "")
    explicit_qa = (os.environ.get("APP_ENV") == "qa" and qa_project and project == qa_project
                   and project != "ai-training-coach-6880b")
    if not (emulator or explicit_qa):
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
                                 "Mock AI is restricted to emulators or the explicitly isolated QA project.")
    return True


@lru_cache(maxsize=1)
def get_client():
    identity_provider = _param(OPENAI_IDENTITY_PROVIDER_ID)
    service_account = _param(OPENAI_SERVICE_ACCOUNT_ID)
    audience = _param(OPENAI_AUDIENCE)
    if not identity_provider or not service_account or not audience:
        raise https_fn.HttpsError(
            https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
            "OpenAI workload identity is not configured. Set OPENAI_IDENTITY_PROVIDER_ID, "
            "OPENAI_SERVICE_ACCOUNT_ID, OPENAI_AUDIENCE and the AI runtime service account.",
        )
    try:
        from openai import OpenAI
        from openai.auth import gcp_id_token_provider
    except ImportError as error:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
                                 "Install an OpenAI Python SDK with workload identity support.") from error
    # Supplying api_key, an arbitrary base URL, or a client credential fallback is
    # deliberately unsupported. This client always uses OpenAI's official origin.
    return OpenAI(
        base_url="https://api.openai.com/v1",
        workload_identity={"identity_provider_id": identity_provider,
                           "service_account_id": service_account,
                           "provider": gcp_id_token_provider(audience=audience)},
        timeout=75.0,
        max_retries=0 if is_exact_qa_environment() else 2,
    )


def file_content(data: bytes, mime_type: str, filename="report.pdf"):
    if not data or len(data) > MAX_FILE_BYTES:
        raise ValueError("Choose a file no larger than 10 MB.")
    encoded = base64.b64encode(data).decode("ascii")
    if mime_type == "application/pdf":
        if not data.lstrip().startswith(b"%PDF-"):
            raise ValueError("The file does not contain a valid PDF header.")
        return {"type": "input_file", "filename": filename,
                "file_data": f"data:application/pdf;base64,{encoded}"}
    if mime_type not in IMAGE_MIME_TYPES:
        raise ValueError("Use a PDF, JPEG, PNG, WebP, or GIF report.")
    signatures = {"image/jpeg": data.startswith(b"\xff\xd8\xff"),
                  "image/png": data.startswith(b"\x89PNG\r\n\x1a\n"),
                  "image/webp": data.startswith(b"RIFF") and data[8:12] == b"WEBP",
                  "image/gif": data.startswith((b"GIF87a", b"GIF89a"))}
    if not signatures[mime_type]:
        raise ValueError("The file content does not match its image type.")
    return {"type": "input_image", "image_url": f"data:{mime_type};base64,{encoded}", "detail": "high"}


def _messages(messages):
    converted = []
    for message in messages:
        role = {"human": "user", "ai": "assistant", "system": "developer"}.get(
            getattr(message, "type", "human"), "user")
        content = getattr(message, "content", message)
        if isinstance(content, str):
            converted.append({"role": role, "content": content})
            continue
        blocks = []
        for block in content:
            if isinstance(block, str):
                blocks.append({"type": "input_text", "text": block})
            elif block.get("type") in {"text", "input_text"}:
                blocks.append({"type": "input_text", "text": block.get("text", "")})
            elif block.get("type") == "image_url":
                url = block.get("image_url", {})
                url = url.get("url", "") if isinstance(url, dict) else url
                if not url.startswith("data:"):
                    raise ValueError("Only inline owned file data is supported.")
                header, encoded = url.split(",", 1)
                mime_type = header.split(";", 1)[0].split(":", 1)[1]
                try:
                    raw = base64.b64decode(encoded, validate=True)
                except (ValueError, TypeError) as error:
                    raise ValueError("The image data is invalid.") from error
                blocks.append(file_content(raw, mime_type))
            elif block.get("type") in {"input_image", "input_file"}:
                blocks.append(block)
        converted.append({"role": role, "content": blocks})
    return converted


def _mock_response(inputs):
    text = "\n".join(item.get("content", "") if isinstance(item.get("content"), str) else
                     "\n".join(block.get("text", "") for block in item.get("content", []) if isinstance(block, dict))
                     for item in inputs)
    if "Classify this health coaching message" in text:
        return "general"
    if "Extract all exercise data" in text:
        return "[]"
    if "Extract ALL data from this body composition report" in text:
        return json.dumps({"source_app": "Synthetic QA scale", "weight_kg": 80,
                           "summary": "Synthetic QA report fixture; not a real extracted measurement."})
    if "Design ONE workout" in text:
        return json.dumps({"name": "Synthetic QA workout", "description": "Synthetic QA fixture.",
                           "exercises": [{"name": "Bodyweight Squat", "sets": 2, "reps": 8, "weight_kg": 0, "rest_sec": 30}]})
    if "Suggest ONE exercise substitution" in text:
        from lib.exercise_substitution import validate_substitution_request, validate_substitution_response
        try:
            request, _ = json.JSONDecoder().raw_decode(text.split("Original exercise and requested reason:", 1)[1].lstrip())
            request = validate_substitution_request(request)
            source = request["exercise"]
            for name in ("Reverse Lunge", "Bodyweight Squat"):
                try:
                    fixture = validate_substitution_response({
                        "substitution": {"name": name, "sets": source["sets"], "reps": source["reps"],
                                         "weight_kg": 0, "rest_sec": source["rest_sec"],
                                         "notes": "Synthetic QA fixture; choose a comfortable starting load."},
                        "reason": "Synthetic QA exercise alternative; no real coaching assessment was performed.",
                    }, request)
                    return json.dumps(fixture)
                except ValueError:
                    continue  # Use the second fixture when the first is the original exercise.
        except (ValueError, IndexError, TypeError):
            pass
        return json.dumps({"substitution": None})
    if "planning TODAY's session" in text:
        routine = []
        try:
            routine, _ = json.JSONDecoder().raw_decode(text.split("Routine template:", 1)[1].lstrip())
        except (ValueError, IndexError):
            pass
        return json.dumps({"insight": "Synthetic QA session plan; original targets retained.",
                           "exercises": [{"name": item.get("name"), "sets": item.get("sets", 2), "reps": item.get("reps", 8),
                                          "weight_kg": item.get("weight_kg", 0), "change": "hold", "note": "Synthetic QA fixture"} for item in routine]})
    if "writing their weekly report" in text:
        return json.dumps({"headline": "Synthetic QA weekly review", "summary": "Synthetic QA narrative; see calculated statistics.",
                           "wins": [], "focus_next_week": ["Keep tracking your training."]})
    if "Analyse this photo of a meal" in text:
        return json.dumps({"name": "Synthetic QA meal", "items": [{"name": "Synthetic QA item", "portion": "fixture", "calories": 100}],
                           "total_calories": 100, "confidence": "low"})
    if "Extract ALL meal plan data" in text:
        return json.dumps({"plan_name": "Synthetic QA meal plan", "dietary_type": "maintenance", "meals": [],
                           "summary": "Synthetic QA fixture; no real nutrition extraction."})
    return "Synthetic QA coach response. Keep recording your training and measurements to review progress."


def respond(inputs, *, task="general", schema=None, schema_name="coach_output", max_output_tokens=None):
    if mock_enabled():
        if schema is not None:
            raise https_fn.HttpsError(https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
                                     "This structured AI operation needs an explicit synthetic fixture.")
        return _mock_response(inputs)
    # Central gate covers all callables, graph nodes and automatic workers.
    # Rejected requests never initialize WIF or contact the model provider.
    if not consume_manual_chat_permit(_AI_USER.get(), task):
        enforce_qa_ai_lease(_AI_USER.get(), task)
    model = _param(OPENAI_ANALYSIS_MODEL if task in {"extraction", "progress"} else OPENAI_GENERAL_MODEL)
    args = {"model": model, "input": inputs, "store": False,
            "max_output_tokens": max_output_tokens or (6000 if task == "extraction" else 2500)}
    if schema is not None:
        args["text"] = {"format": {"type": "json_schema", "name": schema_name,
                                   "schema": schema, "strict": True}}
    try:
        response = get_client().responses.create(**args)
    except https_fn.HttpsError:
        _record_ai(False)
        raise
    except Exception as error:
        _record_ai(False)
        status = getattr(error, "status_code", None)
        code = (https_fn.FunctionsErrorCode.RESOURCE_EXHAUSTED if status == 429 else
                https_fn.FunctionsErrorCode.FAILED_PRECONDITION if status in {401, 403, 404} else
                https_fn.FunctionsErrorCode.UNAVAILABLE)
        message = ("OpenAI quota is unavailable. Try again later." if status == 429 else
                   "OpenAI workload identity or configured model is unavailable. Check server configuration."
                   if status in {401, 403, 404} else "The AI service is temporarily unavailable. Please retry.")
        raise https_fn.HttpsError(code, message) from error
    if getattr(response, "status", "completed") != "completed":
        _record_ai(False)
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.UNAVAILABLE,
                                 "The AI response was incomplete. Try a smaller document or retry.")
    output = getattr(response, "output_text", "")
    if not output:
        _record_ai(False)
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.INVALID_ARGUMENT,
                                 "The AI could not process this content. Try clearer input.")
    if schema is not None:
        try:
            parsed = json.loads(output)
        except (json.JSONDecodeError, TypeError) as error:
            _record_ai(False)
            raise https_fn.HttpsError(https_fn.FunctionsErrorCode.UNAVAILABLE,
                                     "The AI returned an invalid response. Please retry.") from error
        _record_ai(True)
        return parsed
    _record_ai(True)
    return output


class ResponsesChatAdapter:
    """Small LangGraph bridge; no LangChain provider SDK is required."""

    def __init__(self, task="general"):
        self.task = task

    def invoke(self, messages):
        return AIMessage(content=respond(_messages(messages), task=self.task))

    def invoke_structured(self, messages, schema, schema_name):
        if mock_enabled():
            return {"reply": self.invoke(messages).content, "memory_updates": []}
        return respond(_messages(messages), task=self.task, schema=schema, schema_name=schema_name)


def make_llm(task="general"):
    return ResponsesChatAdapter(task)
