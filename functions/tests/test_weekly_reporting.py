"""Offline weekly reports: useful sparse-data copy, factual inputs and report-only writes."""

import copy
import json
import unittest
from datetime import date
from types import SimpleNamespace
from unittest.mock import patch

from lib.weekly_reporting import weekly_fallback, weekly_narrative


def stats(**changes):
    return {"week_start": "2026-10-17", "week_end": "2026-10-23", "sessions": 0,
            "completed_sets": 0, "routines_done": [], "total_volume_kg": 0,
            "prev_volume_kg": 0, "volume_change_pct": None, "weight_start_kg": None,
            "weight_end_kg": None, "weight_delta_kg": None, "weight_day_count": 0,
            "weight_source": None, "avg_energy": None, "session_details": [], **changes}


def narrative(**changes):
    return {"headline": "Recorded training this week", "summary": "You recorded two completed sessions. Keep the next session in your plan.",
            "wins": ["Two completed sessions recorded"], "focus_next_week": ["Record completed sets in your next planned session."], **changes}


class Snapshot:
    def __init__(self, data):
        self.exists = data is not None
        self.data = copy.deepcopy(data)

    def to_dict(self):
        return copy.deepcopy(self.data)


class FakeDB:
    def __init__(self, language="en"):
        self.docs = {"users/synthetic/profile/data": {"response_language": language},
                     "users/synthetic/measurements/historical": {"source_name": "Charlie", "value": 80},
                     "users/synthetic/workout_sessions/historical": {"date": "2020-01-01", "status": "completed", "exercises": []}}
        self.writes = []

    def document(self, path):
        return SimpleNamespace(get=lambda: Snapshot(self.docs.get(path)))

    def collection(self, path):
        db = self

        class Query:
            predicate = None

            def where(self, *, filter):
                self.predicate = filter
                return self

            def get(self):
                prefix = path + "/"
                values = [value for key, value in db.docs.items()
                          if key.startswith(prefix) and "/" not in key[len(prefix):]]
                if self.predicate:
                    values = [value for value in values if value.get(self.predicate.field_path, "") >= self.predicate.value]
                return [Snapshot(value) for value in values]

            def add(self, payload):
                db.writes.append((path, copy.deepcopy(payload)))

        return Query()


class WeeklyNarrativeTests(unittest.TestCase):
    def test_empty_week_has_a_useful_start_and_one_feasible_focus_in_both_languages(self):
        for language in ("en", "es-CR"):
            with self.subTest(language=language):
                result = weekly_narrative(None, stats(), language)
                self.assertTrue(result["summary"])
                self.assertEqual(len(result["focus_next_week"]), 1)
                self.assertEqual(result["wins"], [])
                self.assertNotIn("no sessions", result["summary"].lower())
                self.assertNotIn("inactive", result["summary"].lower())
                self.assertNotIn("Charlie", json.dumps(result))
        self.assertIn("propia báscula", weekly_fallback(stats(), "es")["summary"])

    def test_workouts_only_fallback_uses_sessions_and_sets_without_aggregate_volume(self):
        value = stats(sessions=2, completed_sets=11, total_volume_kg=2345, avg_energy=5)
        result = weekly_narrative(narrative(summary="Nothing to report."), value)
        self.assertIn("2 completed training sessions", result["summary"])
        self.assertIn("11 completed sets", result["summary"])
        self.assertNotIn("2345", result["summary"])
        self.assertNotIn("volume", result["summary"])
        for invented in ("fat", "muscle", "recovery", "100%", "bench", "Charlie"):
            self.assertNotIn(invented, result["summary"])

    def test_aggregate_volume_copy_is_replaced_without_changing_facts(self):
        value = stats(sessions=5, completed_sets=60, total_volume_kg=41731, volume_change_pct=9)
        before = copy.deepcopy(value)
        for field, text in (("summary", "You lifted 41,731 kg of aggregate training volume, up 9%."),
                            ("headline", "Volume up 9%"), ("wins", ["Volumen total: 41731 kg"]),
                            ("focus_next_week", ["Increase total tonnage next week."])):
            with self.subTest(field=field):
                self.assertEqual(weekly_narrative(narrative(**{field: text}), value), weekly_fallback(value))
        self.assertEqual(value, before)
        self.assertIn("compare one exercise", weekly_fallback(value)["focus_next_week"][0])

    def test_one_measurement_day_remains_a_baseline_without_a_delta(self):
        result = weekly_fallback(stats(weight_start_kg=72, weight_end_kg=72, weight_day_count=1))
        self.assertIn("72 kg is a baseline", result["summary"])
        self.assertNotIn("changed", result["summary"])
        self.assertNotIn("0 kg", result["summary"])

    def test_invalid_or_dismissive_provider_copy_falls_back_and_never_mutates_inputs(self):
        invalid = [None, [], "text", {}, narrative(summary=""), narrative(summary={}),
                   narrative(wins="A win"), narrative(focus_next_week=[]), narrative(focus_next_week=[None]),
                   narrative(summary="Nothing new to report."), narrative(summary="Sin novedades."),
                   narrative(summary="No hay nada que destacar."), narrative(summary="Insufficient data.")]
        value = stats(sessions=1, completed_sets=4, total_volume_kg=320)
        expected = weekly_fallback(value)
        before = copy.deepcopy(value)
        for response in invalid:
            with self.subTest(response=response):
                response_before = copy.deepcopy(response)
                self.assertEqual(weekly_narrative(response, value), expected)
                self.assertEqual(response, response_before)
        self.assertEqual(value, before)

    def test_requests_for_repeated_reports_or_named_source_are_replaced(self):
        value = stats(weight_source={"source_name": "Charlie", "method": "anthropometry"})
        for focus in ("Upload another anthropometry report.", "Get a new report from Charlie.",
                      "Schedule Charlie for next week.", "Solicita un nuevo informe.", "Agenda otra medición con Charlie."):
            with self.subTest(focus=focus):
                result = weekly_narrative(narrative(focus_next_week=[focus]), value)
                self.assertEqual(result, weekly_fallback(value))

    def test_historical_provider_cannot_become_a_return_visit_or_data_requirement(self):
        value = stats(historical_measurement_sources=[{"source_name": "Former evaluator", "method": "isak"}],
                      weight_source={"source_name": "Own scale", "method": "bia"})
        for focus in ("Go back to Former evaluator.", "Return to Former evaluator.", "Visit Former evaluator.",
                      "You need measurements from Former evaluator.", "Vuelve con Former evaluator.",
                      "Regresa con Former evaluator.", "Visita a Former evaluator.",
                      "Necesitas una medición de Former evaluator.", "Requieres una lectura de Former evaluator."):
            with self.subTest(focus=focus):
                self.assertEqual(weekly_narrative(narrative(focus_next_week=[focus]), value), weekly_fallback(value))

    def test_valid_provider_copy_is_retained_without_extra_fields(self):
        result = weekly_narrative(narrative(other="ignored"), stats(sessions=2))
        self.assertEqual(result, narrative())


class WeeklyReportIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import main
        cls.main = main

    def test_mocked_provider_receives_source_policy_and_writes_only_disposable_report(self):
        db = FakeDB()
        value = stats(sessions=2, completed_sets=6, total_volume_kg=500,
                      weight_source={"source_name": "Charlie", "method": "anthropometry"})
        before_docs, before_value = copy.deepcopy(db.docs), copy.deepcopy(value)
        model = SimpleNamespace(invoke=lambda messages: SimpleNamespace(content=json.dumps(narrative())))
        with patch.object(self.main, "make_llm", return_value=model), patch.object(model, "invoke", wraps=model.invoke) as invoke:
            result = self.main._generate_weekly_report("synthetic", db, value)
        prompt = invoke.call_args.args[0][0].content
        self.assertIn("historical provenance, never an ongoing dependency", prompt)
        self.assertIn("Do not request another third-party or anthropometry report", prompt)
        self.assertIn("user's own scale or manual measurements", prompt)
        self.assertIn("do not establish inactivity", prompt)
        self.assertIn('"completed_sets": 6', prompt)
        self.assertIn("energy is a self-rating", prompt)
        self.assertIn("Do not mention aggregate training volume", prompt)
        self.assertNotIn("Strong week — volume up", prompt)
        self.assertEqual(db.docs, before_docs)
        self.assertEqual(value, before_value)
        self.assertEqual(len(db.writes), 1)
        self.assertEqual(db.writes[0][0], "users/synthetic/weekly_reports")
        self.assertEqual(result["summary"], narrative()["summary"])
        self.assertNotIn("session_details", result["stats"])

    def test_malformed_or_dismissive_provider_output_is_stored_as_localized_useful_report(self):
        for output in ("not JSON", json.dumps(narrative(summary="Nothing to report.")), json.dumps(narrative(focus_next_week=[]))):
            db = FakeDB("es")
            model = SimpleNamespace(invoke=lambda _, output=output: SimpleNamespace(content=output))
            with patch.object(self.main, "make_llm", return_value=model):
                result = self.main._generate_weekly_report("synthetic", db, stats())
            self.assertIn("propia báscula", result["summary"])
            self.assertEqual(len(result["focus_next_week"]), 1)
            self.assertEqual(db.writes[0][1]["summary"], result["summary"])

    def test_current_manual_reading_starts_own_baseline_and_real_completed_sets_override_cached_totals(self):
        db = FakeDB()
        db.docs["users/synthetic/workout_sessions/current"] = {"date": "2026-10-23", "status": "completed", "total_volume_kg": 999999,
            "exercises": [{"name": "Squat", "load_basis": "total", "sets": [
                {"done": True, "weight_kg": 40, "reps": 5}, {"done": False, "weight_kg": 100, "reps": 10}]}]}
        db.docs["users/synthetic/workout_sessions/active"] = {"date": "2026-10-23", "status": "active", "exercises": []}
        observed = [{"id": "historical", "measured_at": "2026-10-01", "source_name": "Charlie", "method": "anthropometry",
                     "metrics": [{"key": "weight_kg", "value": 80, "unit": "kg"}]},
                    {"id": "own-scale", "measured_at": "2026-10-23", "source_name": "Own scale", "method": "manual",
                     "metrics": [{"key": "weight_kg", "value": 72, "unit": "kg"}]}]
        before_docs, before_observed = copy.deepcopy(db.docs), copy.deepcopy(observed)
        with patch.object(self.main, "local_today", return_value=date(2026, 10, 23)), patch("measurement_api.load_measurement_entries", return_value=observed):
            value = self.main._week_stats("synthetic", db)
        self.assertEqual(value["sessions"], 1)
        self.assertEqual(value["completed_sets"], 1)
        self.assertEqual(value["total_volume_kg"], 200)
        self.assertEqual(value["session_details"][0]["volume_kg"], 200)
        self.assertEqual(value["weight_day_count"], 1)
        self.assertEqual(value["weight_start_kg"], 72)
        self.assertEqual(value["weight_end_kg"], 72)
        self.assertIsNone(value["weight_delta_kg"])
        self.assertEqual(value["weight_source"]["source_name"], "Own scale")
        self.assertEqual(db.docs, before_docs)
        self.assertEqual(observed, before_observed)
        self.assertEqual(db.writes, [])

    def test_newest_historical_assessment_never_displaces_current_own_source(self):
        for historical_method in ("anthropometric", "isak", "skinfold"):
            for current_method in ("manual", "bia"):
                with self.subTest(historical_method=historical_method, current_method=current_method):
                    db = FakeDB()
                    observed = [
                        {"id": "own-1", "measured_at": "2026-10-21", "source_name": "Own scale", "method": current_method,
                         "metrics": [{"key": "weight_kg", "value": 72, "unit": "kg"}]},
                        {"id": "own-2", "measured_at": "2026-10-22", "source_name": "Own scale", "method": current_method,
                         "metrics": [{"key": "weight_kg", "value": 71, "unit": "kg"}]},
                        {"id": "past-report", "measured_at": "2026-10-23", "source_name": "Charlie", "method": historical_method,
                         "metrics": [{"key": "weight_kg", "value": 90, "unit": "kg"}]}]
                    before_observed, before_docs = copy.deepcopy(observed), copy.deepcopy(db.docs)
                    with patch.object(self.main, "local_today", return_value=date(2026, 10, 23)), patch("measurement_api.load_measurement_entries", return_value=observed):
                        value = self.main._week_stats("synthetic", db)
                    self.assertEqual(value["weight_start_kg"], 72)
                    self.assertEqual(value["weight_end_kg"], 71)
                    self.assertEqual(value["weight_delta_kg"], -1)
                    self.assertEqual(value["weight_day_count"], 2)
                    self.assertEqual(value["weight_source"]["source_name"], "Own scale")
                    self.assertEqual(value["historical_measurement_sources"][0]["source_name"], "Charlie")
                    self.assertFalse(value["historical_measurement_sources"][0]["follow_up_required"])
                    self.assertEqual(observed, before_observed)
                    self.assertEqual(db.docs, before_docs)

    def test_historical_assessments_alone_leave_current_weight_unknown_and_reject_return_request(self):
        db = FakeDB()
        observed = [{"id": f"past-report-{index}", "measured_at": day, "source_name": "Charlie", "method": "anthropometric",
                     "metrics": [{"key": "weight_kg", "value": weight, "unit": "kg"}]}
                    for index, (day, weight) in enumerate((("2026-10-21", 80), ("2026-10-23", 79)))]
        before_observed, before_docs = copy.deepcopy(observed), copy.deepcopy(db.docs)
        model = SimpleNamespace(invoke=lambda _: SimpleNamespace(content=json.dumps(narrative(focus_next_week=["Return to Charlie for measurements."]))))
        with patch.object(self.main, "local_today", return_value=date(2026, 10, 23)), patch("measurement_api.load_measurement_entries", return_value=observed), patch.object(self.main, "make_llm", return_value=model):
            report = self.main._generate_weekly_report("synthetic", db)
        for field in ("weight_start_kg", "weight_end_kg", "weight_delta_kg", "weight_source"):
            self.assertIsNone(report["stats"][field])
        self.assertEqual(report["stats"]["weight_day_count"], 0)
        self.assertIn("own scale", report["summary"])
        self.assertNotIn("Charlie", report["summary"] + " ".join(report["focus_next_week"]))
        self.assertEqual(report["stats"]["historical_measurement_sources"][0]["source_name"], "Charlie")
        self.assertEqual(observed, before_observed)
        self.assertEqual(db.docs, before_docs)


if __name__ == "__main__":
    unittest.main()
