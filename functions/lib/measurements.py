"""Measurement facts, normalization and deterministic progress calculations.

These functions intentionally do not call a model or Firestore. AI narratives
are disposable views over these confirmed facts, never their source of truth.
"""

import hashlib
import json
import math
import re
import unicodedata
from datetime import date, datetime, timedelta, timezone
from statistics import median

LOCAL_TIMEZONE = timezone(timedelta(hours=-6))
MAX_METRICS = 120
MAX_ENTRIES_PER_IMPORT = 40

MASS_KEYS = {"weight_kg", "body_fat_kg", "lean_mass_kg", "skeletal_muscle_kg", "muscle_mass_kg",
             "bone_mass_kg", "protein_kg", "residual_mass_kg"}
LENGTH_KEYS = {"height_cm", "waist_cm", "chest_cm", "hips_cm", "arms_cm", "thighs_cm", "calf_cm",
               "relaxed_arm_cm", "tensed_arm_cm", "humerus_cm", "femur_cm"}
ALIASES = {"weight": "weight_kg", "peso": "weight_kg", "height": "height_cm", "talla": "height_cm",
           "body_fat": "body_fat_pct", "body_fat_percentage": "body_fat_pct", "fat_mass": "body_fat_kg",
           "skeletal_muscle": "skeletal_muscle_kg", "muscle_mass": "muscle_mass_kg",
           "lean_mass": "lean_mass_kg", "waist": "waist_cm", "chest": "chest_cm", "hips": "hips_cm",
           "arms": "arms_cm", "thighs": "thighs_cm", "hip_cm": "hips_cm",
           "fat_free_mass": "lean_mass_kg", "fat_free_body_weight": "lean_mass_kg",
           "masa_libre_de_grasa": "lean_mass_kg", "peso_sin_grasa": "lean_mass_kg",
           "masa_muscular": "muscle_mass_kg", "musculo_esqueletico": "skeletal_muscle_kg",
           "muscle_mass_percentage": "muscle_mass_pct", "skeletal_muscle_percentage": "skeletal_muscle_pct",
           "muscle_rate": "muscle_mass_pct", "skeletal_muscle_rate": "skeletal_muscle_pct",
           "body_water_percentage": "body_water_pct", "protein_percentage": "protein_pct"}
UNIT_METRIC_FAMILIES = {"body_fat": "body_fat", "grasa_corporal": "body_fat",
                        "muscle_mass": "muscle_mass", "masa_muscular": "muscle_mass",
                        "skeletal_muscle": "skeletal_muscle", "musculo_esqueletico": "skeletal_muscle",
                        "body_water": "body_water", "agua_corporal": "body_water", "protein": "protein", "proteina": "protein"}
PERCENT_UNITS = {"%", "pct", "percent", "percentage", "porcentaje"}
# A share of body composition is bounded; a device's percentage relative to
# its reference/standard can legitimately exceed 100 (e.g. segmental balance).
BODY_SHARE_KEYS = {"body_fat_pct", "muscle_mass_pct", "skeletal_muscle_pct", "body_water_pct",
                   "bone_mass_pct", "protein_pct", "subcutaneous_fat_pct", "residual_mass_pct"}
MASS_UNITS = {"kg", "kgs", "kilogram", "kilograms", "g", "gram", "grams", "lb", "lbs", "pound", "pounds", "libras"}
LABELS = {"weight_kg": "Weight", "height_cm": "Height", "body_fat_pct": "Body fat",
          "body_fat_kg": "Fat mass", "lean_mass_kg": "Lean mass",
          "skeletal_muscle_kg": "Skeletal muscle", "muscle_mass_kg": "Muscle mass",
          "waist_cm": "Waist", "chest_cm": "Chest", "hips_cm": "Hips", "arms_cm": "Arms",
          "thighs_cm": "Thighs", "body_water_pct": "Body water", "bmi": "BMI"}


def local_today():
    return datetime.now(LOCAL_TIMEZONE).date()


def stable_id(value):
    return hashlib.sha256(str(value).encode("utf-8")).hexdigest()[:28]


def payload_hash(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                     separators=(",", ":"), default=str).encode()).hexdigest()


def slug(value):
    ascii_text = unicodedata.normalize("NFKD", str(value)).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "_", ascii_text.lower()).strip("_")[:80]


def numeric(value):
    if isinstance(value, bool):
        raise ValueError("A measurement must be a number.")
    if isinstance(value, str):
        value = value.strip().replace("\u00a0", "").replace(" ", "")
        if "," in value and "." in value:
            if value.rfind(",") > value.rfind("."):
                value = value.replace(".", "").replace(",", ".")
            else:
                value = value.replace(",", "")
        elif "," in value:
            # Three digits following a lone comma are ambiguous: require review.
            if re.match(r"^[+-]?\d{1,3},\d{3}$", value):
                raise ValueError("This number has an ambiguous separator. Enter its numeric value explicitly.")
            value = value.replace(",", ".")
    try:
        result = float(value)
    except (ValueError, TypeError) as error:
        raise ValueError("A measurement must be a number.") from error
    if not math.isfinite(result) or result < 0 or result > 1_000_000:
        raise ValueError("Measurements must be finite, nonnegative numbers.")
    return result


def canonical_metric_key(metric):
    raw_key = slug(metric.get("key") or metric.get("label") or "")
    unit = str(metric.get("unit") or "").casefold().replace(".", "").replace(" ", "")
    family = UNIT_METRIC_FAMILIES.get(raw_key)
    # Resolve only an unsuffixed name using its explicit original unit. A kg
    # value and a percentage are different observations, never a conversion.
    if family and unit in PERCENT_UNITS:
        return family + "_pct"
    if family and unit in MASS_UNITS:
        return family + "_kg"
    return ALIASES.get(raw_key, raw_key)


def non_observation_metric(metric):
    """Only explicit recommendations/reference metadata are excluded at intake."""
    key = slug(metric.get("key") or "")
    label = slug(metric.get("label") or "")
    keys = {"target_weight", "target_weight_kg", "goal_weight_kg", "recommended_weight", "recommended_weight_kg",
            "ideal_weight", "ideal_weight_kg", "fat_to_lose_kg", "muscle_to_gain_kg", "weight_control_kg",
            "fat_control_kg", "muscle_control_kg", "peso_recomendado", "peso_objetivo"}
    labels = {"recommended_weight", "target_weight", "ideal_weight", "reference_range", "peso_recomendado",
              "peso_objetivo", "peso_ideal", "rango_de_referencia", "control_de_peso", "control_de_grasa", "control_muscular"}
    return key in keys or key.startswith(("reference_range_", "rango_de_referencia_")) or label in labels


def normalize_metric(metric):
    if not isinstance(metric, dict):
        raise ValueError("Invalid metric.")
    raw_key = slug(metric.get("key") or metric.get("label") or "")
    if not raw_key:
        raise ValueError("Give every measurement a name.")
    key = canonical_metric_key(metric)
    value = numeric(metric.get("value"))
    unit = str(metric.get("unit") or "").strip()[:30]
    original_unit = unit
    normalized_unit = unit.casefold().replace(".", "").replace(" ", "")
    raw_value = str(metric.get("raw_value") if metric.get("raw_value") is not None else metric.get("value"))[:100]
    if key in MASS_KEYS or key.endswith("_kg"):
        if normalized_unit in {"lb", "lbs", "pound", "pounds", "libras"}:
            value *= 0.45359237
        elif normalized_unit in {"g", "gram", "grams"}:
            value /= 1000
        elif normalized_unit not in {"kg", "kgs", "kilogram", "kilograms", ""}:
            raise ValueError(f"Check the mass unit for {key}.")
        unit = "kg"
    elif key in LENGTH_KEYS or key.endswith("_cm"):
        if normalized_unit in {"in", "inch", "inches", '"', "pulgadas"}:
            value *= 2.54
        elif normalized_unit in {"mm"}:
            value /= 10
        elif normalized_unit in {"m", "meter", "meters"}:
            value *= 100
        elif normalized_unit not in {"cm", "centimeter", "centimeters", ""}:
            raise ValueError(f"Check the length unit for {key}.")
        unit = "cm"
    elif key.endswith("_mm"):
        if normalized_unit == "cm":
            value *= 10
        elif normalized_unit in {"in", "inch", "inches"}:
            value *= 25.4
        elif normalized_unit not in {"mm", ""}:
            raise ValueError(f"Check the skinfold unit for {key}.")
        unit = "mm"
    elif key.endswith("_pct"):
        if normalized_unit not in PERCENT_UNITS | {""}:
            raise ValueError(f"Check the percentage unit for {key}.")
        if key in BODY_SHARE_KEYS and value > 100:
            raise ValueError("Body-composition shares must be between 0 and 100 percent.")
        unit = "%"
    elif key in {"visceral_fat_level", "bmi", "body_score", "metabolic_age"}:
        if key == "visceral_fat_level" and normalized_unit in {"%", "kg", "lb"}:
            raise ValueError("A visceral-fat rating is not a percentage or mass.")
        unit = "years" if key == "metabolic_age" else "index" if key in {"visceral_fat_level", "bmi"} else "score"
    result = {"key": key, "label": str(metric.get("label") or LABELS.get(key) or raw_key.replace("_", " "))[:100],
              "value": round(value, 5), "unit": unit,
              "raw_value": raw_value, "raw_unit": str(metric.get("raw_unit") if metric.get("raw_unit") is not None else original_unit)[:30]}
    if metric.get("evidence"):
        result["evidence"] = str(metric["evidence"])[:500]
    confidence = metric.get("confidence")
    if confidence in {"low", "medium", "high"}:
        result["confidence"] = confidence
    return result


def normalize_entry(entry, *, draft=False):
    if not isinstance(entry, dict):
        raise ValueError("Invalid measurement entry.")
    measured_at = entry.get("measured_at") or None
    if measured_at:
        if not isinstance(measured_at, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", measured_at):
            raise ValueError("Choose a measurement date in YYYY-MM-DD format.")
        try:
            date.fromisoformat(measured_at)
        except ValueError as error:
            raise ValueError("Choose a valid measurement date.") from error
    metrics = entry.get("metrics", [])
    if not isinstance(metrics, list) or not metrics or len(metrics) > MAX_METRICS:
        raise ValueError("Enter between 1 and 120 measurements per observation.")
    normalized = []
    keys = set()
    for item in metrics:
        metric = normalize_metric(item)
        if metric["key"] in keys:
            raise ValueError("Keep separate readings as separate observations; a metric is repeated.")
        normalized.append(metric)
        keys.add(metric["key"])
    result = {"measured_at": measured_at, "source_name": str(entry.get("source_name") or "Manual")[:120],
              "method": str(entry.get("method") or "manual")[:80], "metrics": normalized,
              "notes": str(entry.get("notes") or "")[:2000]}
    if not draft:
        result["confirmed"] = True
    return result


def flatten_report(report):
    metrics = []
    skip = {"source_app", "report_date", "report_url", "report_storage_path", "error", "fat_method"}
    for key, value in report.items():
        if key in skip or value is None:
            continue
        if isinstance(value, dict):
            # Targets are recommendations and must not enter measured trends.
            if key == "weight_control":
                continue
            for subkey, subvalue in value.items():
                if isinstance(subvalue, (float, int)) and not isinstance(subvalue, bool):
                    metrics.append({"key": f"{key}_{subkey}" if key in {"segmental_muscle", "segmental_fat", "bia", "somatotype"} else subkey,
                                    "label": f"{key.replace('_', ' ')} {subkey.replace('_', ' ')}",
                                    "value": subvalue, "unit": "kg" if subkey.endswith("_kg") else "cm" if subkey.endswith("_cm") else "mm" if subkey.endswith("_mm") else ""})
        elif isinstance(value, (float, int)) and not isinstance(value, bool):
            metrics.append({"key": key, "value": value,
                            "unit": "kg" if key.endswith("_kg") else "cm" if key.endswith("_cm") else "%" if key.endswith("_pct") else "mm" if key.endswith("_mm") else ""})
    return metrics


def legacy_entries(logs, reports):
    """Read legacy records without writing; stable IDs deduplicate mirrored files."""
    entries, mirrored = [], set()
    for report in reports:
        data = report.get("extracted_data") or {}
        metrics = flatten_report(data)
        if not metrics:
            continue
        reference = report.get("storage_path") or report.get("download_url")
        if reference:
            mirrored.add(reference)
        entry_id = "legacy_report_" + str(report["id"])
        raw = {"measured_at": report.get("report_date") or data.get("report_date"),
               "source_name": report.get("source_app") or data.get("source_app") or "Legacy report",
               "method": data.get("fat_method") or ("anthropometric" if data.get("skinfolds") else "bia"),
               "metrics": metrics}
        try:
            entry = normalize_entry(raw)
        except ValueError:
            continue
        entries.append({**entry, "id": entry_id, "legacy_ref": {"kind": "report", "id": report["id"]},
                        "storage_path": report.get("storage_path"), "original_url": report.get("download_url"),
                        "summary": report.get("ai_summary"), "revision": 0})
    for log in logs:
        log_id = log.get("date") or log.get("id")
        if not log_id:
            continue
        manual = {key: log.get(key) for key in ("weight_kg", "body_fat_pct") if log.get(key) is not None}
        manual.update({key: value for key, value in (log.get("measurements") or {}).items() if value is not None})
        metrics = flatten_report(manual)
        if metrics:
            try:
                entry = normalize_entry({"measured_at": log_id, "source_name": "Manual", "method": "manual", "metrics": metrics})
                entries.append({**entry, "id": "legacy_manual_" + log_id,
                                "legacy_ref": {"kind": "manual", "id": log_id}, "revision": 0})
            except ValueError:
                pass
        report = log.get("body_composition_report") or {}
        reference = report.get("report_storage_path") or report.get("report_url")
        if not report or (reference and reference in mirrored):
            continue
        metrics = flatten_report(report)
        if not metrics:
            continue
        try:
            entry = normalize_entry({"measured_at": report.get("report_date"),
                                     "source_name": report.get("source_app") or "Legacy report",
                                     "method": report.get("fat_method") or ("anthropometric" if report.get("skinfolds") else "bia"),
                                     "metrics": metrics})
            entries.append({**entry, "id": "legacy_log_report_" + log_id,
                            "legacy_ref": {"kind": "log_report", "id": log_id},
                            "storage_path": report.get("report_storage_path"),
                            "original_url": report.get("report_url"), "revision": 0})
        except ValueError:
            pass
    return entries


def comparable_group(entry):
    return (str(entry.get("source_name", "")).strip().casefold(), str(entry.get("method", "")).strip().casefold())


REFERENCE_METRIC_UNITS = {"weight_kg": "kg", "body_fat_pct": "%", "relaxed_arm_cm": "cm",
                          "tensed_arm_cm": "cm", "waist_cm": "cm", "thighs_cm": "cm", "calf_cm": "cm"}


def prior_measurement_references(entries, before_date, *, source_name=None, method=None, exclude_entry_id=None):
    """Read-only prior values; daily medians keep repeats within their source/method.

    Returned entries are reference projections, never replacements for saved facts.
    Only canonical aliases and exact stored units qualify; generic arms, skinfolds
    and bone breadths cannot stand in for the requested circumferences.
    """
    preferred = comparable_group({"source_name": source_name, "method": method}) if source_name and method else None
    rows = {key: [] for key in REFERENCE_METRIC_UNITS}
    for entry in entries:
        measured = entry.get("measured_at")
        if not isinstance(measured, str) or (exclude_entry_id is not None and entry.get("id") == exclude_entry_id):
            continue
        try:
            if date.fromisoformat(measured).isoformat() != measured or measured >= before_date:
                continue
        except ValueError:
            continue
        for metric in entry.get("metrics", []):
            if not isinstance(metric, dict):
                continue
            key, value = canonical_metric_key(metric), metric.get("value")
            if (key not in rows or metric.get("unit") != REFERENCE_METRIC_UNITS[key]
                    or isinstance(value, bool) or not isinstance(value, (int, float))
                    or not math.isfinite(value) or value < 0):
                continue
            rows[key].append((entry, metric))
    references = []
    for key, candidates in rows.items():
        if not candidates:
            continue
        matches = [row for row in candidates if comparable_group(row[0]) == preferred] if preferred else []
        entry, metric = max(matches or candidates, key=lambda row: (row[0]["measured_at"], str(row[0].get("id") or "")))
        day_rows = [row for row in (matches or candidates) if row[0]["measured_at"] == entry["measured_at"]
                    and comparable_group(row[0]) == comparable_group(entry)]
        references.append({"id": entry.get("id"), "measured_at": entry["measured_at"],
                           "source_name": entry.get("source_name"), "method": entry.get("method"),
                           "metrics": [{"key": key, "label": metric.get("label") or LABELS.get(key, key),
                                        "unit": REFERENCE_METRIC_UNITS[key],
                                        "value": median(row[1]["value"] for row in day_rows)}],
                           "reference_aggregation": "daily_median", "reference_reading_count": len(day_rows),
                           "reference_source_ids": sorted({row[0]["id"] for row in day_rows if row[0].get("id")})})
    return references


def comparisons(entries, days=90, today=None):
    today = today or local_today()
    cutoff = (today - timedelta(days=days - 1)).isoformat()
    groups = {}
    for entry in sorted(entries, key=lambda item: (item.get("measured_at") or "", item.get("id") or "")):
        measured = entry.get("measured_at")
        if not measured or not cutoff <= measured <= today.isoformat():
            continue
        for metric in entry.get("metrics", []):
            key = (*comparable_group(entry), metric["key"], metric["unit"])
            groups.setdefault(key, []).append((entry, metric))
    result = []
    for key, rows in groups.items():
        # Two different dates are needed for a trend; same-day repeats remain visible facts.
        first, last = rows[0], rows[-1]
        if first[0]["measured_at"] == last[0]["measured_at"]:
            continue
        start_rows = [row for row in rows if row[0]["measured_at"] == first[0]["measured_at"]]
        end_rows = [row for row in rows if row[0]["measured_at"] == last[0]["measured_at"]]
        start_value = median(row[1]["value"] for row in start_rows)
        end_value = median(row[1]["value"] for row in end_rows)
        result.append({"key": key[2], "label": last[1]["label"], "unit": key[3],
                       "source_name": last[0].get("source_name"), "method": last[0].get("method"),
                       "start_date": first[0]["measured_at"], "end_date": last[0]["measured_at"],
                       "start_value": start_value, "end_value": end_value,
                       "delta": round(end_value - start_value, 5), "aggregation": "daily_median",
                       "reading_count": len(rows), "source_ids": [row[0]["id"] for row in [*start_rows, *end_rows]]})
    return result


def workout_rollup(sessions, days=90, today=None):
    today = today or local_today()
    cutoff = (today - timedelta(days=days - 1)).isoformat()
    selected = [s for s in sessions if s.get("status") == "completed"
                and cutoff <= str(s.get("date") or "") <= today.isoformat()]
    total_volume, completed_sets, duration, exercises = 0.0, 0, 0.0, {}

    def nonnegative(value):
        try:
            parsed = float(value)
            return parsed if math.isfinite(parsed) and parsed >= 0 and not isinstance(value, bool) else 0
        except (ValueError, TypeError):
            return 0

    for session in selected:
        duration += nonnegative(session.get("duration_min"))
        for exercise in session.get("exercises") or []:
            name = exercise.get("name") or "Exercise"
            done = [s for s in exercise.get("sets") or [] if s.get("done")]
            completed_sets += len(done)
            for item in done:
                weight = nonnegative(item.get("weight_kg"))
                reps = nonnegative(item.get("reps"))
                total_volume += weight * reps
                best = exercises.setdefault(name, {"name": name, "top_weight_kg": 0, "completed_sets": 0})
                best["top_weight_kg"] = max(best["top_weight_kg"], weight)
                best["completed_sets"] += 1
    return {"days": days, "sessions": len(selected), "completed_sets": completed_sets,
            "total_volume_kg": round(total_volume, 2), "duration_min": round(duration, 1),
            "exercise_count": len(exercises), "exercises": sorted(exercises.values(), key=lambda item: -item["completed_sets"])[:20],
            "source_ids": [s["id"] for s in selected if s.get("id")]}


def source_fingerprint(entries, sessions=()):
    facts = [{key: entry.get(key) for key in ("id", "measured_at", "source_name", "method", "metrics", "notes", "revision")}
             for entry in sorted(entries, key=lambda entry: entry["id"])]
    workout_facts = [{key: session.get(key) for key in ("id", "date", "status", "exercises", "duration_min")}
                     for session in sorted(sessions, key=lambda session: session.get("id", ""))
                     if session.get("status") == "completed"]
    return payload_hash({"entries": facts, "sessions": workout_facts})


def record_facts(entry):
    return {"id": entry["id"], "measured_at": entry.get("measured_at"), "source_name": entry.get("source_name"),
            "method": entry.get("method"), "metrics": [{key: metric[key] for key in ("key", "label", "value", "unit")}
                                                       for metric in entry.get("metrics", [])], "notes": entry.get("notes", "")}


def entry_fact_summary(entry, language="en"):
    """A compact memory of this observation only: no inferred dependencies."""
    spanish = str(language).startswith("es")
    measured = entry.get("measured_at") or ("Fecha sin especificar" if spanish else "Date not specified")
    values = [f"{metric.get('label') or metric['key']}: {metric['value']:g} {metric['unit']}" for metric in entry.get("metrics", [])[:12]]
    text = f"{measured} · {entry.get('source_name') or 'Manual'} · {entry.get('method') or 'unknown'}. " + "; ".join(values)
    remaining = len(entry.get("metrics", [])) - 12
    if remaining > 0:
        text += f". {remaining} " + ("mediciones adicionales en el registro original." if spanish else "additional measurements in the source record.")
    return text[:2000]


def factual_progress_digest(entries, sessions=(), *, today=None, language="en", history_incomplete=False,
                            workout_history_incomplete=False, max_groups=240):
    """All available history, calculated from facts without model interpretation.

    Every source/method/metric/unit remains separate. A day's repeated readings
    contribute its median, so random document IDs cannot select a baseline.
    Unknown dates and future records are counted but never inserted into trends.
    """
    today = today or local_today()
    spanish = str(language).startswith("es")
    from lib.progress_reporting import measurement_tracking_context
    tracking = measurement_tracking_context(entries, today=today)

    def parsed_day(value):
        try:
            return date.fromisoformat(value) if isinstance(value, str) else None
        except ValueError:
            return None

    dated, undated, future = [], 0, 0
    for entry in entries:
        day = parsed_day(entry.get("measured_at"))
        if day is None:
            undated += 1
        elif day > today:
            future += 1
        else:
            dated.append(entry)
    dates = sorted({entry["measured_at"] for entry in dated})
    groups = {}
    for entry in sorted(dated, key=lambda item: (item.get("measured_at") or "", item.get("id") or "")):
        for metric in entry.get("metrics", []):
            value = metric.get("value")
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                continue
            key = (*comparable_group(entry), metric.get("key", ""), metric.get("unit", ""))
            group = groups.setdefault(key, {"key": key[2], "label": metric.get("label") or key[2], "unit": key[3],
                "source_name": entry.get("source_name"), "method": entry.get("method"), "values": {}})
            group["values"].setdefault(entry["measured_at"], []).append(value)

    metrics = []
    for group in groups.values():
        values = group.pop("values")
        daily = [(day, median(readings)) for day, readings in sorted(values.items())]
        baseline, latest = daily[0], daily[-1]
        span_days = (date.fromisoformat(latest[0]) - date.fromisoformat(baseline[0])).days
        minimum = min(daily, key=lambda row: (row[1], row[0]))
        maximum = max(daily, key=lambda row: (row[1], row[0]))
        cutoff = (today - timedelta(days=89)).isoformat()
        recent_daily = [row for row in daily if row[0] >= cutoff]
        recent_window = None
        if recent_daily:
            recent_first, recent_last = recent_daily[0], recent_daily[-1]
            recent_span = (date.fromisoformat(recent_last[0]) - date.fromisoformat(recent_first[0])).days
            recent_delta = round(recent_last[1] - recent_first[1], 5) if recent_span else None
            recent_window = {"baseline_date": recent_first[0], "latest_date": recent_last[0],
                "baseline_value": recent_first[1], "latest_value": recent_last[1], "date_count": len(recent_daily),
                "span_days": recent_span, "delta": recent_delta,
                "rate_per_week": round(recent_delta * 7 / recent_span, 5) if recent_span else None}
        delta = round(latest[1] - baseline[1], 5) if span_days else None
        milestone_indexes = sorted({round((len(daily) - 1) * fraction / 4) for fraction in range(5)})
        metrics.append({**group, "baseline_date": baseline[0], "latest_date": latest[0],
            "baseline_value": baseline[1], "latest_value": latest[1],
            "delta": delta, "span_days": span_days,
            "rate_per_week": round(delta * 7 / span_days, 5) if span_days else None,
            "delta_unit": "pp" if group["unit"] == "%" else group["unit"], "aggregation": "daily_median",
            "reading_count": sum(len(readings) for readings in values.values()), "date_count": len(daily),
            "minimum_value": minimum[1], "minimum_date": minimum[0], "maximum_value": maximum[1], "maximum_date": maximum[0],
            "milestones": [{"date": daily[index][0], "value": daily[index][1]} for index in milestone_indexes],
            "recent_window": recent_window,
            "direction_reversal": bool(delta is not None and recent_window and recent_window["delta"] is not None
                                       and delta * recent_window["delta"] < 0)})
    core = ("weight_kg", "body_fat_pct", "body_fat_kg", "muscle_mass_kg", "muscle_mass_pct",
            "skeletal_muscle_kg", "skeletal_muscle_pct", "lean_mass_kg", "waist_cm", "body_water_pct", "bmi", "protein_pct")
    priority = {key: index for index, key in enumerate(core)}
    def metric_priority(key):
        if key in priority:
            return priority[key]
        # Formula-qualified facts retain their own metric key and definition,
        # while appearing beside the broad family in the explanation.
        for name, rank in priority.items():
            if key.endswith("_" + name):
                return rank + 0.1
        if key in {"sum_6_skinfolds_mm", "sum_8_skinfolds_mm"}:
            return len(core) + 0.1
        if key.endswith("_mass_kg") or key.endswith("_mass_pct"):
            return len(core) + 0.2
        return len(core) + 1
    metrics.sort(key=lambda item: (metric_priority(item["key"]),
        str(item.get("source_name") or "").casefold(), str(item.get("method") or "").casefold(), item["key"], item["unit"]))
    omitted = max(0, len(metrics) - max_groups)

    completed, undated_workouts, future_workouts = [], 0, 0
    for session in sessions:
        if session.get("status") != "completed":
            continue
        day = parsed_day(session.get("date"))
        if day is None:
            undated_workouts += 1
        elif day > today:
            future_workouts += 1
        else:
            completed.append(session)

    def workouts_between(start, end):
        selected = [session for session in completed if start <= session["date"] <= end]
        start_day, end_day = date.fromisoformat(start), date.fromisoformat(end)
        result = workout_rollup(selected, (end_day - start_day).days + 1, end_day)
        result.pop("source_ids", None)  # Evidence remains in the original session documents.
        return {**result, "start_date": start, "end_date": end}

    first_workout = min((session["date"] for session in completed), default=today.isoformat())
    all_workouts = workouts_between(first_workout, today.isoformat())
    period_workouts = workouts_between(dates[0], dates[-1]) if dates else None
    cutoff = (today - timedelta(days=89)).isoformat()
    recent = [entry for entry in dated if entry["measured_at"] >= cutoff]
    recent_deltas = comparisons(dated, 90, today)
    recent_workouts = workouts_between(cutoff, today.isoformat())
    limitations = [
        "Las comparaciones usan medianas diarias y separan fuente, método, indicador y unidad."
        if spanish else "Comparisons use daily medians and separate source, method, metric and unit.",
        "La coincidencia entre entrenamiento y mediciones no demuestra causalidad; el volumen registrado no mide por sí solo la fuerza."
        if spanish else "Workout and measurement association does not prove causation; logged volume alone does not measure strength.",
    ]
    if undated or future or undated_workouts or future_workouts:
        limitations.append("Los registros sin fecha válida o con fecha futura se cuentan aparte y no se usan para tendencias."
                           if spanish else "Undated, invalid-date and future records are counted separately and excluded from trends.")
    if history_incomplete or workout_history_incomplete:
        limitations.append("Se alcanzó el límite de lectura: este resumen cubre los registros cargados, no todo el historial."
                           if spanish else "The read limit was reached: this summary covers loaded records, not the entire history.")
    if omitted or len(recent_deltas) > max_groups:
        limitations.append("Algunos grupos no caben en el detalle del resumen; sus registros originales se conservan."
                           if spanish else "Some groups exceed the summary detail limit; their original records are retained.")

    labels_es = {"weight_kg": "Peso", "body_fat_pct": "Grasa corporal", "body_fat_kg": "Masa grasa",
        "muscle_mass_kg": "Masa muscular total", "muscle_mass_pct": "Masa muscular total",
        "skeletal_muscle_kg": "Músculo esquelético", "skeletal_muscle_pct": "Músculo esquelético",
        "lean_mass_kg": "Masa libre de grasa", "waist_cm": "Cintura", "body_water_pct": "Agua corporal",
        "bmi": "IMC", "protein_pct": "Proteína"}
    labels_es.update({"chest_cm": "Pecho", "hips_cm": "Cadera", "arms_cm": "Brazo", "thighs_cm": "Muslo",
        "calf_cm": "Pantorrilla", "relaxed_arm_cm": "Brazo relajado", "tensed_arm_cm": "Brazo contraído",
        "sum_6_skinfolds_mm": "Suma de 6 pliegues", "sum_8_skinfolds_mm": "Suma de 8 pliegues"})

    def label(item):
        return labels_es.get(item["key"], item["label"]) if spanish else item["label"]

    def source(item):
        return " · ".join(str(value) for value in (item.get("source_name"), item.get("method")) if value) or "Manual"

    def quantity(value, unit="", signed=False):
        # Display precision does not change the stored, unrounded source values.
        number = f"{value:+.3f}" if signed else f"{value:.3f}"
        number = number.rstrip("0").rstrip(".")
        return f"{number} {unit}".strip()

    def change_description(item):
        if item["delta"] is None:
            return "Hay una sola fecha: todavía no permite calcular un cambio longitudinal." if spanish else \
                   "Only one date is available, so longitudinal change cannot yet be calculated."
        return ((f"El balance entre ambas fechas es {quantity(item['delta'], item['delta_unit'], True)} en {item['span_days']} días. "
                 f"El cambio medio entre esos extremos equivale a {quantity(item['rate_per_week'], item['delta_unit'], True)} por semana; "
                 "describe ese intervalo y no predice las próximas semanas.") if spanish else
                (f"The change between those dates is {quantity(item['delta'], item['delta_unit'], True)} across {item['span_days']} days. "
                 f"The average change between these endpoints is {quantity(item['rate_per_week'], item['delta_unit'], True)} per week; "
                 "it describes that interval and does not predict future weeks."))

    def chronology(item):
        points = item["milestones"][1:-1]
        middle = "; ".join(f"{point['date']}: {quantity(point['value'], item['unit'])}" for point in points)
        text = ((f"Las fechas intermedias observadas incluyen {middle}. " if spanish else
                 f"Observed intermediate checkpoints include {middle}. ") if middle else "")
        text += ((f"El mínimo de las medianas diarias fue {quantity(item['minimum_value'], item['unit'])} el {item['minimum_date']}; "
                  f"el máximo fue {quantity(item['maximum_value'], item['unit'])} el {item['maximum_date']}. ") if spanish else
                 (f"The lowest daily median was {quantity(item['minimum_value'], item['unit'])} on {item['minimum_date']}; "
                  f"the highest was {quantity(item['maximum_value'], item['unit'])} on {item['maximum_date']}. "))
        if item["date_count"] > 1 and item["minimum_date"] < item["latest_date"] and item["latest_value"] > item["minimum_value"]:
            amount = quantity(item["latest_value"] - item["minimum_value"], item["delta_unit"], True)
            text += (f"La última lectura está {amount} por encima de ese mínimo; el cambio total no debe ocultar esa recuperación desde el mínimo."
                     if spanish else f"The latest reading is {amount} above that minimum; the overall change should not hide that rise from the minimum.")
        elif item["date_count"] > 1 and item["maximum_date"] < item["latest_date"] and item["latest_value"] < item["maximum_value"]:
            amount = quantity(item["latest_value"] - item["maximum_value"], item["delta_unit"], True)
            text += (f"La última lectura está {amount} respecto de aquel máximo."
                     if spanish else f"The latest reading is {amount} relative to that earlier maximum.")
        return text.strip()

    sources = sorted({source(item) for item in metrics})
    lines = ["**Resumen acumulado de progreso**" if spanish else "**Cumulative progress summary**",
        "## 1. Qué historial está incluido" if spanish else "## 1. What history is included",
        (f"{len(entries)} registros; {len(dates)} fechas de medición. " if spanish else
         f"{len(entries)} observations; {len(dates)} measurement dates. ") +
        ((f"Periodo: {dates[0]} a {dates[-1]}, con {(date.fromisoformat(dates[-1]) - date.fromisoformat(dates[0])).days} días entre los extremos. "
          if spanish else f"Period: {dates[0]} to {dates[-1]}, spanning {(date.fromisoformat(dates[-1]) - date.fromisoformat(dates[0])).days} days between endpoints. ")
         if dates else ("Todavía no hay mediciones con fecha válida. " if spanish else "No dated measurements are available yet. ")) +
        ("Este resumen se calcula directamente de los valores guardados: describe lo registrado, sin completar fechas ni resultados que falten."
         if spanish else "This summary is calculated directly from saved values: it describes what was recorded without filling in missing dates or results."),
        (f"Hay {len(sources)} combinaciones de fuente y método y {len(metrics)} grupos de indicadores. "
         "Si hay varias lecturas del mismo indicador, fuente y método en un día, se usa la mediana de ese día. "
         "Así, una repetición no se trata como un nuevo día de progreso. Las fechas y los extremos que siguen corresponden a esas medianas."
         if spanish else f"There are {len(sources)} source-and-method combinations and {len(metrics)} metric groups. "
         "Repeated readings of the same metric, source and method on a day use that day's median. "
         "A repeat is therefore not treated as another day of progress. The dates and extremes below refer to these daily medians.")]
    if undated or future:
        lines.append((f"Sin fecha: {undated}; con fecha futura: {future}. Estos registros se conservan, pero no se usan para describir la evolución."
                      if spanish else f"Undated: {undated}; future-dated: {future}. These records are retained but excluded from longitudinal comparisons."))

    lines.append("## 2. La evolución del peso, con sus etapas" if spanish else "## 2. Weight over time, including intermediate stages")
    weights = [item for item in metrics if item["key"] == "weight_kg" and item["unit"] == "kg"]
    if not weights:
        lines.append("No hay pesos fechados en kg con los que reconstruir esta evolución. Las demás mediciones siguen siendo útiles por separado."
                     if spanish else "No dated weights in kg are available to reconstruct this history. Other measurements remain useful separately.")
    for item in weights[:4]:
        lines.append((f"**{source(item)}.** El punto de partida es {quantity(item['baseline_value'], item['unit'])} el {item['baseline_date']}, "
                      f"y la última mediana es {quantity(item['latest_value'], item['unit'])} el {item['latest_date']}. " if spanish else
                      f"**{source(item)}.** The baseline is {quantity(item['baseline_value'], item['unit'])} on {item['baseline_date']}, "
                      f"and the latest median is {quantity(item['latest_value'], item['unit'])} on {item['latest_date']}. ") + change_description(item))
        lines.append(chronology(item))

    lines.append("## 3. Composición corporal y medidas: qué cambió realmente en los registros" if spanish else
                 "## 3. Body composition and measurements: what changed in the records")
    composition = [item for item in metrics if item not in weights]
    if not composition:
        lines.append("Aún no hay indicadores adicionales fechados en este historial. Con peso solamente no se puede separar cuánto del cambio corresponde a grasa, músculo o agua."
                     if spanish else "No additional dated metrics are available in this history. Weight alone cannot distinguish changes in fat, muscle or water.")
    for item in composition[:16]:
        text = (f"**{label(item)} — {source(item)}:** {quantity(item['baseline_value'], item['unit'])} ({item['baseline_date']}) "
                f"→ {quantity(item['latest_value'], item['unit'])} ({item['latest_date']}). ")
        if item["delta"] is not None:
            text += ((f"Cambio: {quantity(item['delta'], item['delta_unit'], True)}, a lo largo de {item['date_count']} fechas distintas. "
                      if spanish else f"Change: {quantity(item['delta'], item['delta_unit'], True)}, across {item['date_count']} distinct dates. "))
            text += ((f"El intervalo observado va de {quantity(item['minimum_value'], item['unit'])} ({item['minimum_date']}) "
                      f"a {quantity(item['maximum_value'], item['unit'])} ({item['maximum_date']})." if spanish else
                      f"The observed daily-median range runs from {quantity(item['minimum_value'], item['unit'])} ({item['minimum_date']}) "
                      f"to {quantity(item['maximum_value'], item['unit'])} ({item['maximum_date']})."))
        else:
            text += "Es un punto de referencia, todavía sin una segunda fecha comparable." if spanish else "This is a baseline, with no second comparable date yet."
        lines.append(text)
    if len(composition) > 16 or len(weights) > 4 or omitted:
        lines.append((f"La explicación desarrolla hasta 4 series de peso y 16 de otros indicadores; el detalle estructurado conserva {min(len(metrics), max_groups)} "
                      f"de {len(metrics)} grupos. Los registros originales mantienen los indicadores restantes." if spanish else
                      f"This explanation develops up to 4 weight series and 16 other metrics; structured detail retains {min(len(metrics), max_groups)} "
                      f"of {len(metrics)} groups. Original records retain the remaining metrics."))

    lines.append("## 4. El balance total frente a los últimos 90 días" if spanish else "## 4. Full-history change versus the last 90 days")
    lines.append((f"La ventana reciente va de {cutoff} a {today.isoformat()}: contiene {len(recent)} mediciones en "
                  f"{len({entry['measured_at'] for entry in recent})} fechas y {recent_workouts['sessions']} sesiones completadas. "
                  "Su primera medición real puede ser posterior al inicio de la ventana; las tasas se calculan solo entre fechas que sí tienen datos."
                  if spanish else f"The recent window is {cutoff} to {today.isoformat()}: it contains {len(recent)} observations on "
                  f"{len({entry['measured_at'] for entry in recent})} dates and {recent_workouts['sessions']} completed sessions. "
                  "Its first actual measurement may be later than the window start; rates use only dates with recorded data."))
    recent_metrics = [item for item in metrics if item["recent_window"] and metric_priority(item["key"]) < len(core)][:8]
    for item in recent_metrics:
        window = item["recent_window"]
        text = (f"**{label(item)} — {source(item)}:** ")
        if window["delta"] is None:
            text += (f"solo hay una fecha reciente ({window['latest_date']}); no se calcula una tendencia de 90 días."
                     if spanish else f"only one recent date is available ({window['latest_date']}); a 90-day change cannot be calculated.")
        else:
            text += ((f"de {quantity(window['baseline_value'], item['unit'])} el {window['baseline_date']} a "
                      f"{quantity(window['latest_value'], item['unit'])} el {window['latest_date']}: "
                      f"{quantity(window['delta'], item['delta_unit'], True)} en {window['span_days']} días "
                      f"({quantity(window['rate_per_week'], item['delta_unit'], True)} por semana entre esos extremos)."
                      if spanish else f"from {quantity(window['baseline_value'], item['unit'])} on {window['baseline_date']} to "
                      f"{quantity(window['latest_value'], item['unit'])} on {window['latest_date']}: "
                      f"{quantity(window['delta'], item['delta_unit'], True)} over {window['span_days']} days "
                      f"({quantity(window['rate_per_week'], item['delta_unit'], True)} per week between those endpoints)."))
            if item["direction_reversal"]:
                text += (" El sentido del cambio reciente es contrario al balance de todo el historial: la evolución tuvo etapas y no fue uniforme."
                         if spanish else " Recent change runs opposite to the full-history change: the history includes different phases rather than a uniform direction.")
            elif item["delta"] is not None:
                text += (" Este cambio reciente y el balance total deben leerse como intervalos distintos, no como un ritmo constante."
                         if spanish else " This recent change and the full-history balance describe different intervals, not a constant rate.")
        lines.append(text)
    if not recent_metrics:
        lines.append("No hay una serie reciente de los indicadores principales con la que comparar el periodo completo. No se extrapolan las lecturas antiguas."
                     if spanish else "There is no recent core-metric series to compare with the full period. Older readings are not extrapolated.")

    lines.append("## 5. Qué aporta el entrenamiento guardado" if spanish else "## 5. What the saved workout history adds")
    lines.append((f"Historial de entrenamiento disponible: {all_workouts['sessions']} sesiones completadas, {all_workouts['completed_sets']} series marcadas como completadas "
                  f"y {all_workouts['exercise_count']} ejercicios distintos. " if spanish else
                  f"Available workout history: {all_workouts['sessions']} completed sessions, {all_workouts['completed_sets']} sets marked completed "
                  f"and {all_workouts['exercise_count']} distinct exercises. ") +
                 ((f"Dentro del periodo de mediciones hay {period_workouts['sessions']} sesiones; "
                   f"{sum(session['date'] in set(dates) for session in completed)} sesiones coinciden con una fecha de medición. " if spanish else
                   f"The measurement period contains {period_workouts['sessions']} sessions; "
                   f"{sum(session['date'] in set(dates) for session in completed)} sessions share a measurement date. ") if period_workouts is not None else "") +
                 ("Se cuentan las sesiones reales completadas, sin volver a sumar sus copias en registros diarios."
                  if spanish else "Only actual completed sessions are counted; their daily-log mirrors are not counted again."))
    if all_workouts["sessions"]:
        workout_dates = sorted({session["date"] for session in completed})
        lines.append((f"Las sesiones disponibles van de {workout_dates[0]} a {workout_dates[-1]}. El volumen externo registrado suma "
                      f"{quantity(all_workouts['total_volume_kg'], 'kg')} de carga por repeticiones, usando solo series completadas con datos válidos; "
                      "no representa toda la actividad física ni el trabajo de ejercicios sin carga externa."
                      if spanish else f"Available sessions run from {workout_dates[0]} to {workout_dates[-1]}. Recorded external-load volume totals "
                      f"{quantity(all_workouts['total_volume_kg'], 'kg')} of load multiplied by repetitions, using only completed sets with valid data; "
                      "it does not represent all physical activity or work performed without external load."))
    if all_workouts["sessions"] < 4:
        lines.append("La cobertura de entrenamiento guardado es escasa: permite describir esas sesiones, pero no evaluar una progresión de fuerza sostenida ni atribuirles los cambios corporales. Que falten sesiones en la app no significa que no hayas entrenado."
                     if spanish else "Saved workout coverage is sparse: these sessions can be described, but they cannot establish sustained strength progression or explain body-composition changes. Missing sessions in the app do not mean that you did not train.")
    else:
        lines.append("El número de sesiones describe la cobertura de la app, no una garantía de que todo el entrenamiento esté registrado. Para estudiar progresión hacen falta ejercicios repetidos con sus series, repeticiones y cargas comparables."
                     if spanish else "Session count describes app coverage, not a guarantee that every workout was logged. Progression needs repeated exercises with comparable sets, repetitions and loads.")

    lines.append("## 6. Cómo interpretar las fuentes, las unidades y sus límites" if spanish else "## 6. How to interpret sources, units and their limits")
    if sources:
        lines.append(("Las series identificadas son: " if spanish else "The identified series are: ") + "; ".join(sources[:12]) +
                     (". Cada una conserva su propio punto de partida: cambiar de equipo o método no crea una continuidad automática entre valores."
                      if spanish else ". Each retains its own baseline: changing device or method does not automatically create one continuous series."))
    if tracking["historical_sources"]:
        historical_names = "; ".join(item["source_name"] for item in tracking["historical_sources"][:6])
        lines.append((f"Referencias históricas: {historical_names}. Sus mediciones se conservan como evidencia de esas fechas; "
                      "no se esperan nuevas lecturas de esas fuentes ni se usan para fijar objetivos actuales. El seguimiento puede continuar con tu báscula o "
                      "mediciones propias, guardadas con su fuente y método como una referencia independiente."
                      if spanish else f"Historical references: {historical_names}. Their measurements remain evidence of those dates; "
                      "no further readings from these sources are expected, and they do not set current targets. Tracking can continue with your own scale or manual "
                      "measurements, saved under their own source and method as an independent baseline."))
    method_names = {str(entry.get("method") or "").casefold() for entry in dated}
    if "bia" in method_names:
        # General BIA guidance: https://inbodyusa.com/general/inbody-test/ and /general/technology/.
        lines.append("Los resultados identificados como BIA son estimaciones del equipo a partir de impedancia, no una medición directa del tejido muscular o graso. Las condiciones de la prueba importan: conviene registrar y repetir condiciones semejantes de horario, hidratación y relación con el ejercicio. Un cambio aislado debe contrastarse con lecturas posteriores del mismo equipo."
                     if spanish else "Results identified as BIA are device estimates from impedance, not direct measurements of muscle or fat tissue. Testing conditions matter: record and repeat similar timing, hydration and timing relative to exercise. Check an isolated change against later readings from the same device.")
    if method_names.intersection({"anthropometric", "isak", "skinfold"}):
        lines.append("Las mediciones antropométricas, los perímetros y los pliegues conservan la técnica y la fuente del informe. No se mezclan con los porcentajes estimados por una báscula BIA; si cambia el evaluador, el protocolo o la fórmula, anótalo antes de interpretar diferencias como progreso."
                     if spanish else "Anthropometry, circumferences and skinfolds retain the report's technique and source. They are not merged with BIA scale percentages; note changes in evaluator, protocol or equation before interpreting differences as progress.")
    if any(item["key"].startswith("anthropometric_muscle_mass_") for item in metrics):
        lines.append("La masa muscular calculada por antropometría mantiene la definición del informe y su serie propia. No se resta de la masa muscular total de BIA para afirmar una ganancia o pérdida: una diferencia entre esos números puede corresponder a definiciones y métodos distintos. Lo mismo ocurre con grasa calculada mediante una fórmula identificada: su nombre se conserva y se compara dentro de esa fórmula."
                     if spanish else "Anthropometric muscle mass retains the report's definition and its own series. It is not subtracted from BIA total muscle mass to claim a gain or loss: different numbers may reflect different definitions and methods. Fat derived from an identified equation likewise keeps its equation label and is compared within that equation.")
    lines.append("La masa muscular total, el músculo esquelético y la masa libre de grasa son indicadores distintos. Además, kg expresa una cantidad y % una proporción del peso: una proporción puede aumentar sin que aumenten los kg. Por eso se muestran por separado y un cambio de porcentaje se expresa en puntos porcentuales (pp), no como kg ni como un cambio porcentual relativo."
                 if spanish else "Total muscle mass, skeletal muscle and fat-free mass are different metrics. Also, kg is an amount and % is a share of body weight: a share can rise without a rise in kg. They remain separate, and percentage changes are expressed in percentage points (pp), not kg or relative percentage change.")
    lines.extend(limitations)

    lines.append("## 7. Qué conviene guardar en las próximas mediciones" if spanish else "## 7. Useful details to save with future measurements")
    lines.append("Para mantener una comparación clara, guarda fecha real, fuente o equipo y método; si dispones de la hora o de condiciones de la prueba, consérvalas en las notas. Repite una serie con condiciones parecidas antes de interpretar una oscilación como una tendencia. El informe original sigue siendo la evidencia para revisar valores, unidades y cualquier discrepancia."
                 if spanish else "For a clear comparison, save the actual date, source or device, and method; retain the time and testing conditions in notes when available. Repeat a series under similar conditions before treating a fluctuation as a trend. The original report remains the evidence for checking values, units and discrepancies.")
    present_keys = {item["key"] for item in metrics}
    manual = ("Si quieres continuar sin informes de un tercero, puedes introducir manualmente peso en kg y cintura en cm. "
              "Los perímetros de cadera, pecho, brazo y muslo son opcionales: usa siempre el mismo punto de medición y guarda cada uno por separado. "
              if spanish else "To continue without third-party reports, you can enter body weight in kg and waist in cm manually. "
              "Hip, chest, arm and thigh circumferences are optional: use the same measurement site and save each separately. ")
    if "waist_cm" not in present_keys:
        manual += ("En este historial todavía no hay una serie de cintura; añadirla crearía una referencia independiente del peso y de la BIA. "
                   if spanish else "This history does not yet include a waist series; adding one would create a reference independent of body weight and BIA. ")
    manual += ("Añade % de grasa, kg de músculo o pliegues solo cuando tengas una lectura o una medición real, con su unidad y método; no hace falta inventarlos para completar el registro."
               if spanish else "Add body-fat %, muscle kg or skinfolds only when you have a real reading or measurement, including its unit and method; missing fields do not need invented values.")
    lines.append(manual)
    lines.append("Para relacionar las próximas mediciones con el entrenamiento, registra las sesiones realmente completadas y, en ejercicios repetidos, las series, repeticiones y cargas. Eso permitirá comparar el rendimiento con más contexto, manteniendo separadas las observaciones de cualquier explicación causal."
                 if spanish else "To place future measurements alongside training, log completed sessions and the sets, repetitions and loads of repeated exercises. That will support more contextual performance comparisons while keeping observations separate from causal explanations.")
    return {"kind": "progress-facts-v1", "narrative_version": 3, "status": "ready", "summary": "\n\n".join(lines),
        "tracking_context": tracking,
        "range": {"start_date": dates[0] if dates else None, "end_date": dates[-1] if dates else None, "as_of": today.isoformat()},
        "counts": {"observations": len(entries), "dated_observations": len(dated), "measurement_dates": len(dates),
            "undated_observations": undated, "future_observations": future, "metric_groups": len(metrics), "metric_groups_omitted": omitted},
        "metrics": metrics[:max_groups], "workouts": {"all_history": all_workouts, "during_measurement_history": period_workouts,
            "sessions_on_measurement_days": sum(session["date"] in set(dates) for session in completed),
            "undated_completed_sessions": undated_workouts, "future_completed_sessions": future_workouts},
        "recent_90_days": {"start_date": cutoff, "end_date": today.isoformat(), "observations": len(recent),
            "measurement_dates": len({entry["measured_at"] for entry in recent}), "comparisons": recent_deltas[:max_groups],
            "comparison_groups_omitted": max(0, len(recent_deltas) - max_groups), "workouts": recent_workouts},
        "limitations": limitations, "history_incomplete": bool(history_incomplete or workout_history_incomplete)}


def comparable_weight_series(entries, start, end):
    """Freshest source/method only; same-day repeats use a labelled daily median."""
    groups = {}
    for entry in entries:
        day = entry.get("measured_at")
        if not day or not start <= day <= end:
            continue
        weight = next((metric for metric in entry.get("metrics", []) if metric["key"] == "weight_kg" and metric["unit"] == "kg"), None)
        if weight is None:
            continue
        group = groups.setdefault(comparable_group(entry), {"source_name": entry.get("source_name"), "method": entry.get("method"), "days": {}})
        group["days"].setdefault(day, []).append(weight["value"])
    if not groups:
        return [], None
    selected = max(groups.values(), key=lambda group: (max(group["days"]), len(group["days"]), str(group["source_name"])))
    series = [(day, float(median(values))) for day, values in sorted(selected["days"].items())]
    return series, {"source_name": selected["source_name"], "method": selected["method"], "aggregation": "daily_median"}
