"""Useful weekly narratives when the provider returns sparse or unusable copy.

This is a disposable view over recorded facts. It never changes measurements,
workout snapshots or the meaning of a historical measurement source.
"""

import math
import re
import unicodedata


def _fold(value):
    return "".join(char for char in unicodedata.normalize("NFKD", value.casefold())
                   if not unicodedata.combining(char))


def _number(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) else None


def current_weekly_weight_entries(entries):
    """Assessments retain their historical role instead of driving current tracking."""
    historical_methods = {"anthropometric", "isak", "skinfold"}
    return [entry for entry in entries
            if str(entry.get("method") or "").strip().casefold() not in historical_methods]


def weekly_fallback(stats, language="en"):
    """Provide a concrete recorded fact or starting point, with one feasible focus."""
    spanish = str(language).casefold().startswith("es")
    sessions = _number(stats.get("sessions")) or 0
    sets = _number(stats.get("completed_sets"))
    weight = _number(stats.get("weight_end_kg"))
    delta = _number(stats.get("weight_delta_kg"))
    lines, wins = [], []

    if sessions:
        count = f"{sessions:g}"
        headline = (f"Entrenamiento registrado: {count} " + ("sesión" if sessions == 1 else "sesiones") if spanish
                    else f"Training recorded: {count} " + ("session" if sessions == 1 else "sessions"))
        if spanish:
            lines.append(f"Esta semana registraste {count} " + ("sesión completada" if sessions == 1 else "sesiones completadas") + ".")
        else:
            lines.append(f"You recorded {count} completed training " + ("session." if sessions == 1 else "sessions."))
        if sets is not None:
            detail = (f"Hay {sets:g} series completadas" if spanish else f"There are {sets:g} completed sets")
            lines.append(detail + ".")
        wins.append((f"{count} " + ("sesión completada registrada" if sessions == 1 else "sesiones completadas registradas")) if spanish
                    else f"{count} completed " + ("session recorded" if sessions == 1 else "sessions recorded"))
    else:
        headline = "Construye tu próxima referencia" if spanish else "Build your next reference point"

    if weight is not None and delta is not None:
        signed = f"{delta:+g}"
        lines.append((f"El peso registrado cambió {signed} kg entre días de la misma fuente y método de medición."
                      if spanish else f"Recorded weight changed by {signed} kg across days from the same measurement source and method."))
        wins.append("Comparación de peso con fuente y método compatibles" if spanish else "A source-compatible weight comparison is available")
    elif weight is not None:
        lines.append((f"El peso registrado de {weight:g} kg sirve de referencia inicial; aún no establece una tendencia compatible."
                      if spanish else f"The recorded weight of {weight:g} kg is a baseline; it does not yet establish a compatible trend."))
    if not lines:
        lines.append("Puedes construir el seguimiento con tus sesiones y las mediciones que decidas registrar. Una lectura de tu propia báscula o una medida manual puede iniciar una referencia nueva, separada de las fuentes anteriores."
                     if spanish else "Your recorded sessions and measurements can build a useful view of progress. A reading from your own scale or a manual measurement can start a new baseline, kept separate from older sources.")
    elif not sessions:
        lines.append("Los detalles de una sesión completada pueden añadir otra referencia útil al seguimiento."
                     if spanish else "Details from a completed session can add another useful reference for your progress.")

    focus = ("Registra las series completadas de tu próxima sesión planificada, o añade una sesión que ya hayas completado."
             if spanish else "Record the completed sets from your next planned session, or add a session you already completed.")
    if sessions:
        focus = ("En tu próxima sesión, compara las repeticiones y cargas de un ejercicio con su registro anterior usando la misma máquina y convención de carga."
                 if spanish else "Next session, compare one exercise’s reps and loads with its previous record using the same equipment and load convention.")
    return {"headline": headline, "summary": " ".join(lines), "wins": wins[:3], "focus_next_week": [focus]}


def weekly_narrative(narrative, stats, language="en"):
    """Use provider copy only when it contains a useful summary and real actions."""
    fallback = weekly_fallback(stats, language)
    if not isinstance(narrative, dict):
        return fallback
    text_fields = (narrative.get("headline"), narrative.get("summary"))
    if not all(isinstance(value, str) and value.strip() for value in text_fields):
        return fallback
    wins, focus = narrative.get("wins"), narrative.get("focus_next_week")
    if (not isinstance(wins, list) or not isinstance(focus, list) or not focus
            or any(not isinstance(value, str) or not value.strip() for value in [*wins, *focus])):
        return fallback

    combined = _fold(" ".join([*text_fields, *wins, *focus]))
    dismissive = r"nothing (?:new |meaningful |noteworthy )?to (?:report|share|add)|no (?:meaningful |useful )?(?:updates|insights|news)|nothing noteworthy|not enough data|insufficient data|no hay (?:nada|novedades)|nada (?:nuevo )?que (?:reportar|informar|destacar)|sin novedades|datos insuficientes|no hay suficientes datos"
    # A weekly report must remain useful when a former provider stops measuring.
    # Historical provenance can be named, but it never creates a follow-up duty.
    request = r"(?:upload|obtain|request|schedule|repeat|book|get|ask|provide|send|go back|return|visit|needs?|requires?|await|until|sube|subir|obten|solicita|programa|repite|repetir|agenda|pide|envia|enviar|vuelve|volver|regresa|regresar|retorna|retornar|acude|acudir|visita|visitar|necesita\w*|requiere\w*|espera\w*)"
    external = r"(?:report|assessment|anthropometr|skinfold|isak|third.party|nutritionist|dietitian|evaluator|informe|evaluacion|antropometr|pliegues|nutricionista|evaluador)"
    aggregate_volume = r"\bvolume\b|\bvolumen\b|tonnage|tonelaje|kilograms? lifted|kilos? levantados"
    if re.search(aggregate_volume, combined) or re.search(dismissive, combined) or re.search(rf"\b{request}\b.{{0,100}}{external}", combined):
        return fallback
    sources = [stats.get("weight_source") or {}, *(stats.get("historical_measurement_sources") or [])]
    for item in sources:
        source_name = item.get("source_name") if isinstance(item, dict) else None
        if not isinstance(source_name, str) or not source_name.strip():
            continue
        source = re.escape(_fold(source_name.strip()))
        if re.search(rf"\b{request}\b.{{0,100}}{source}|{source}.{{0,100}}\b{request}\b", combined):
            return fallback
    return {"headline": text_fields[0].strip(), "summary": text_fields[1].strip(),
            "wins": [value.strip() for value in wins[:3]], "focus_next_week": [value.strip() for value in focus[:3]]}
