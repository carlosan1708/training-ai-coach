"""Small, factual reporting views over saved measurement and workout evidence.

These helpers never change observations or decide that a particular provider is
retired. An assessment remains a historical reference, while an existing home
measurement setup can support an independent ongoing series.
"""

import math
import re
import unicodedata
from datetime import date

from lib.measurements import local_today


TRACKING_POLICY = (
    "Historical reports remain available; future third-party reports are optional, never a requirement. "
    "Own measurements start a separate source/method baseline."
)
_HISTORICAL_METHODS = {"anthropometric", "isak", "skinfold"}
_ONGOING_METHODS = {"manual", "bia"}
_GENERIC_SOURCE_STARTS = {
    "the", "manual", "scale", "clinic", "clinica", "body", "report", "reports", "informe", "informes",
    "legacy", "unknown", "synthetic", "nutricion", "nutrition", "assessment", "historical", "source",
    "measurement", "measurements", "anthropometric", "anthropometry", "professional", "profesional",
    "evaluacion", "center", "centre", "centro",
}
_PRIORITY = {key: rank for rank, key in enumerate((
    "weight_kg", "waist_cm", "body_fat_pct", "skeletal_muscle_kg", "muscle_mass_kg",
    "lean_mass_kg", "relaxed_arm_cm", "tensed_arm_cm", "thighs_cm", "calf_cm",
))}
_LABELS_ES = {"weight_kg": "Peso", "waist_cm": "Cintura", "body_fat_pct": "Grasa corporal",
              "skeletal_muscle_kg": "Músculo esquelético", "muscle_mass_kg": "Masa muscular",
              "lean_mass_kg": "Masa libre de grasa", "relaxed_arm_cm": "Brazo relajado",
              "tensed_arm_cm": "Brazo contraído", "thighs_cm": "Muslo", "calf_cm": "Pantorrilla"}


def _text(value):
    return " ".join(value.split()) if isinstance(value, str) else ""


def _fold(value):
    return unicodedata.normalize("NFKD", _text(value)).encode("ascii", "ignore").decode().casefold()


def _valid_day(value, today):
    if not isinstance(value, str):
        return None
    try:
        parsed = date.fromisoformat(value)
        return value if parsed.isoformat() == value and parsed <= today else None
    except ValueError:
        return None


def _rows(value):
    return [item for item in value if isinstance(item, dict)] if isinstance(value, (list, tuple)) else []


def _method(entry):
    return _text(entry.get("method")).casefold()


def ongoing_tracking_entries(entries):
    """Select existing home-tracking facts; date/trend validation stays separate."""
    return [entry for entry in _rows(entries) if _method(entry) in _ONGOING_METHODS]


def measurement_tracking_context(entries, *, today=None):
    """Describe source roles without changing or inferring the user's history."""
    today = today or local_today()
    groups = {}
    for entry in _rows(entries):
        method = _method(entry)
        if method not in _HISTORICAL_METHODS | _ONGOING_METHODS:
            continue
        day = _valid_day(entry.get("measured_at"), today)
        # An undated observation still identifies a source. A future reading
        # does not establish a historical reference or a current setup.
        if entry.get("measured_at") and not day:
            continue
        source = _text(entry.get("source_name"))
        key = (source.casefold(), method)
        group = groups.setdefault(key, {"source_name": source, "method": method, "latest_date": None,
                                       "role": "historical_reference" if method in _HISTORICAL_METHODS
                                       else "ongoing_tracking_option"})
        if method in _HISTORICAL_METHODS:
            group["follow_up_required"] = False
        if day and (not group["latest_date"] or day > group["latest_date"]):
            group["latest_date"] = day
    ordered = [groups[key] for key in sorted(groups)]
    historical = [group for group in ordered if group["role"] == "historical_reference"]
    ongoing = [group for group in ordered if group["role"] == "ongoing_tracking_option"]
    return {"historical_sources": historical[:50], "ongoing_sources": ongoing[:50],
            "omitted_sources": max(0, len(historical) - 50) + max(0, len(ongoing) - 50),
            "policy": TRACKING_POLICY}


def _finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _count(value):
    return int(value) if _finite(value) and value >= 0 and int(value) == value else None


def _number(value):
    return f"{value:g}"


def _short(value, words=6):
    parts = _text(value).split()
    return " ".join(parts[:words]) + ("…" if len(parts) > words else "")


def _dismissive(value):
    text = _fold(value)
    return bool(re.search(r"\bnothing(?:\s+(?:new|much|else))?\s+to\s+report\b|"
                          r"\bnada(?:\s+nuevo)?\s+(?:que|para)\s+(?:reportar|informar)\b|"
                          r"\bno\s+(?:hay\s+)?(?:new\s+)?updates?\b", text))


def _valid_text(value, limit):
    text = _text(value)
    return text if text and any(character.isalnum() for character in text) and len(text.split()) <= limit and not _dismissive(text) else ""


def _report_followup(action, context):
    """Keep generated actions from making a professional report a prerequisite."""
    folded = _fold(action)
    report = re.search(r"\b(?:reports?|assessment|anthropometr\w*|skinfolds?|isak|professional|"
                       r"nutritionist|dietitian|evaluator|informes?|evaluacion|antropometr\w*|"
                       r"pliegues?|profesional|nutricionista|evaluador)\b", folded)
    directive = re.search(r"\b(?:get|obtain|upload|book|schedule|repeat|request|ask|update|needs?|needing|"
                          r"return|visit|see|go|requires?|await|until|vuelve|volver|regresa|regresar|acude|acudir|visita|visitar|"
                          r"measure|continue|keep|same|nuevo|nueva|sube|subir|carga|cargar|repite|"
                          r"repetir|solicita|solicitar|pide|pedir|necesita\w*|mide|medir|mismo|misma)\b", folded)
    known_historical = any(group["source_name"] and re.search(
        r"(?<!\w)" + re.escape(_fold(group["source_name"])) + r"(?!\w)", folded)
        for group in context["historical_sources"])
    # A person's short name often stands in for a longer source label. Restrict
    # that alias to explicit follow-up requests in the same clause so a dated
    # historical mention remains valid factual copy.
    source_alias_request = False
    followup = (r"(?:go\s+back(?:\s+to)?|return(?:\s+to)?|visit|book|needs?|needing|"
                r"vuelve|volver|regresa|regresar|visita|visitar|necesita\w*|reserva|reservar)")
    for group in context["historical_sources"]:
        source_tokens = re.findall(r"\b\w+\b", _fold(group["source_name"]))
        if len(source_tokens) < 2 or len(source_tokens[0]) < 4 or source_tokens[0] in _GENERIC_SOURCE_STARTS:
            continue
        if re.search(rf"\b{followup}\b[^.!?;]{{0,80}}\b{re.escape(source_tokens[0])}\b", folded):
            source_alias_request = True
            break
    explicitly_optional = bool(re.search(r"\b(?:no need|do not need|don't need|never need|not required|"
                                         r"no necesitas?|no hace falta|no es necesario|opcionales?|optional)\b", folded))
    if ((report or known_historical) and directive or source_alias_request) and not explicitly_optional:
        return True
    # With historical assessments alone, "repeat the same method" would still
    # steer the user back to a third party despite omitting the word report.
    if context["historical_sources"] and not context["ongoing_sources"]:
        return bool(re.search(r"\b(?:same\s+(?:measurement\s+)?(?:source|method|setup)|repeat\s+(?:the\s+)?(?:reading|measurement)|"
                              r"mism[oa]\s+(?:fuente|metodo|equipo)|repite\s+(?:la\s+)?medicion)\b", folded))
    return False


def _next_step(entries, context, spanish):
    today = local_today()
    ongoing = [entry for entry in ongoing_tracking_entries(entries)
               if _valid_day(entry.get("measured_at"), today)]
    latest = max(ongoing, key=lambda entry: entry["measured_at"], default=None)
    if latest and _method(latest) == "bia":
        return ("Usa la misma báscula y condiciones parecidas en tu próxima lectura; guarda la fecha y mantén esta serie separada de los informes históricos."
                if spanish else "Use the same scale and similar conditions for your next reading; record the date and keep this series separate from historical reports.")
    if latest:
        return ("Registra tu próxima medición manual con la misma técnica y punto de medición; conserva esta serie con su propia fuente."
                if spanish else "Record your next manual measurement with the same technique and measurement site; keep this series under its own source.")
    if context["historical_sources"]:
        return ("Cuando puedas, registra tu propio peso o cintura con fecha, unidad y método como una referencia independiente de los informes históricos."
                if spanish else "When convenient, record your own weight or waist with its date, unit and method as a baseline independent of historical reports.")
    return ("Guarda una medición que puedas hacer tú, con fecha, unidad y método, para establecer una referencia propia."
            if spanish else "Save one measurement you can make yourself, with its date, unit and method, to establish your own baseline.")


def _workout_sentence(workouts, spanish):
    workouts = workouts if isinstance(workouts, dict) else {}
    sessions, sets = _count(workouts.get("sessions")), _count(workouts.get("completed_sets"))
    if sessions is None and sets is None:
        return ""
    session_label = ("entrenamiento completado" if sessions == 1 else "entrenamientos completados") if spanish else ("completed workout" if sessions == 1 else "completed workouts")
    set_label = ("serie completada" if sets == 1 else "series completadas") if spanish else ("completed set" if sets == 1 else "completed sets")
    if sessions is not None and sets is not None:
        return (f"En este periodo registraste {sessions} {session_label} y {sets} {set_label}."
                if spanish else f"This period has {sessions} {session_label} and {sets} {set_label} recorded.")
    if sessions is not None:
        return (f"En este periodo registraste {sessions} {session_label}."
                if spanish else f"This period has {sessions} {session_label} recorded.")
    return (f"En este periodo registraste {sets} {set_label}."
            if spanish else f"This period has {sets} {set_label} recorded.")


def _fallback_summary(entries, comparisons, workouts, spanish):
    today = local_today()
    dated = [entry for entry in _rows(entries) if _valid_day(entry.get("measured_at"), today)]
    available = [(entry, metric) for entry in dated for metric in _rows(entry.get("metrics"))
                 if _finite(metric.get("value")) and isinstance(metric.get("unit"), str)]
    # An assessment may be newer than a home reading, but remains evidence of
    # the past. Ongoing tracking supplies the current reference independently.
    ongoing = [item for item in available if _method(item[0]) in _ONGOING_METHODS]
    available = ongoing or available
    available.sort(key=lambda item: (item[0]["measured_at"], -_PRIORITY.get(item[1].get("key"), 100)), reverse=True)
    workout_text = _workout_sentence(workouts, spanish)
    if not available:
        status = ("Aún no hay una medición con fecha válida para describir cambios corporales."
                  if spanish else "A dated measurement is still needed to describe body changes.")
        return " ".join(part for part in (workout_text, status) if part)
    entry, metric = available[0]
    label = _LABELS_ES.get(metric.get("key"), metric.get("label")) if spanish else metric.get("label")
    label = _short(label or metric.get("key") or ("Medición" if spanish else "Reading"), 3)
    source = _short(entry.get("source_name"), 5) or ("fuente desconocida" if spanish else "unknown source")
    method = _short(entry.get("method"), 2) or ("método desconocido" if spanish else "unknown method")
    historical = _method(entry) in _HISTORICAL_METHODS
    reference = ("Referencia histórica" if spanish else "Historical reference") if historical else (
        "Última lectura fechada" if spanish else "Latest dated reading")
    # Report a supplied delta only when its dates, source, method and metric
    # describe this latest fact. Never derive or extrapolate a new delta here.
    comparable = [item for item in _rows(comparisons)
                  if item.get("key") == metric.get("key") and item.get("unit") == metric["unit"]
                  and _text(item.get("source_name")).casefold() == _text(entry.get("source_name")).casefold()
                  and _text(item.get("method")).casefold() == _method(entry)
                  and _valid_day(item.get("start_date"), today) and item.get("end_date") == entry["measured_at"]
                  and item["start_date"] < item["end_date"]
                  and all(_finite(item.get(key)) for key in ("start_value", "end_value", "delta"))]
    if comparable:
        item = max(comparable, key=lambda value: value["start_date"])
        prefix = f"{reference}: " if historical else ""
        measurement = (f"{prefix}{label}: {_number(item['start_value'])} → {_number(item['end_value'])} {metric['unit']}; "
                       f"{item['start_date']}–{item['end_date']} ({source}; {method}).")
    else:
        measurement = (f"{reference}: {label} "
                       f"{_number(metric['value'])} {metric['unit']}, {entry['measured_at']} ({source}; {method}).")
    summary = " ".join(part for part in (workout_text, measurement) if part)
    # A single observation is useful evidence without being a trend. Keep this
    # qualification when it fits rather than cutting off a factual sentence.
    if not comparable:
        caveat = "Esta lectura no establece una tendencia." if spanish else "This reading alone does not establish a trend."
        if len((summary + " " + caveat).split()) <= 45:
            summary += " " + caveat
    return summary if len(summary.split()) <= 45 else measurement


def normalize_progress_narrative(narrative, entries, comparisons, workouts, profile):
    """Keep useful model copy and fill malformed or dismissive sections from facts."""
    narrative = narrative if isinstance(narrative, dict) else {}
    profile = profile if isinstance(profile, dict) else {}
    spanish = _text(profile.get("response_language")).casefold().startswith("es")
    context = measurement_tracking_context(entries)
    summary = _valid_text(narrative.get("summary"), 45)
    if summary and _report_followup(summary, context):
        summary = ""
    summary = summary or _fallback_summary(entries, comparisons, workouts, spanish)
    focus_values = narrative.get("focus")
    focus = next((text for value in focus_values if (text := _valid_text(value, 30))
                  and not _report_followup(text, context)), "") if isinstance(focus_values, list) else ""
    focus = focus or _next_step(entries, context, spanish)
    win_values = narrative.get("wins")
    wins = [text for value in win_values if (text := _valid_text(value, 30))
            and not _report_followup(text, context)][:1] if isinstance(win_values, list) else []
    if not wins and isinstance(workouts, dict) and (_count(workouts.get("sessions")) or 0) > 0:
        count = _count(workouts["sessions"])
        wins = [(f"Registraste {count} " + ("entrenamiento completado." if count == 1 else "entrenamientos completados.")) if spanish
                else (f"You recorded {count} " + ("completed workout." if count == 1 else "completed workouts."))]
    return {"summary": summary, "wins": wins, "focus": [focus]}
