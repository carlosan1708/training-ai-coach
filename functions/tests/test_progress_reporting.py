"""Reporting fallbacks use local synthetic evidence, without provider calls."""

import copy
from datetime import date
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lib.progress_reporting import measurement_tracking_context, normalize_progress_narrative, ongoing_tracking_entries


TODAY = date(2026, 10, 23)


def reading(identifier="synthetic-reference", day="2026-10-10", source="Synthetic assessment", method="anthropometric", value=80):
    return {"id": identifier, "measured_at": day, "source_name": source, "method": method,
            "metrics": [{"key": "weight_kg", "label": "Weight", "value": value, "unit": "kg"}]}


class ProgressReportingTests(unittest.TestCase):
    def setUp(self):
        clock = patch("lib.progress_reporting.local_today", return_value=TODAY)
        clock.start()
        self.addCleanup(clock.stop)

    def normalize(self, narrative=None, entries=None, comparisons=None, workouts=None, language="en"):
        result = normalize_progress_narrative(narrative, entries or [], comparisons or [], workouts or {},
                                              {"response_language": language})
        self.assertLessEqual(len(result["summary"].split()), 45)
        self.assertLessEqual(len(result["wins"]), 1)
        self.assertEqual(len(result["focus"]), 1)
        self.assertLessEqual(len(result["focus"][0].split()), 30)
        self.assertTrue(result["summary"])
        return result

    def test_dismissive_and_empty_reports_use_facts_and_independent_baseline(self):
        for summary in ("", "Nothing to report", "Nothing new to report.", "Nada que reportar.", "No hay nada nuevo que informar."):
            with self.subTest(summary=summary):
                result = self.normalize({"summary": summary, "wins": [], "focus": []}, [reading()],
                                        workouts={"sessions": 2, "completed_sets": 14})
                self.assertIn("2 completed workouts and 14 completed sets", result["summary"])
                self.assertIn("80 kg", result["summary"])
                self.assertIn("2026-10-10", result["summary"])
                self.assertIn("Synthetic assessment; anthropometric", result["summary"])
                self.assertIn("Historical reference", result["summary"])
                self.assertIn("baseline independent of historical reports", result["focus"][0])
                self.assertNotIn("another report", result["focus"][0])

    def test_workouts_only_are_observations_and_do_not_imply_body_progress(self):
        result = self.normalize({"summary": "Nothing to report"}, workouts={"sessions": 3, "completed_sets": 21})
        self.assertIn("3 completed workouts and 21 completed sets", result["summary"])
        self.assertIn("dated measurement", result["summary"])
        self.assertIn("own baseline", result["focus"][0])
        self.assertEqual(result["wins"], ["You recorded 3 completed workouts."])
        self.assertNotRegex(result["summary"], r"fat loss|muscle gain|caused|improved")

    def test_empty_and_malformed_values_never_become_invented_zero_counts(self):
        for narrative in (None, [], {"summary": 9, "wins": "wins", "focus": "focus"},
                          {"summary": "word " * 46, "focus": [None, "word " * 31]}):
            with self.subTest(narrative=narrative):
                result = self.normalize(narrative, workouts={"sessions": "unknown", "completed_sets": -2})
                self.assertNotIn("0 completed", result["summary"])
                self.assertEqual(result["wins"], [])
                self.assertIn("own baseline", result["focus"][0])

    def test_valid_model_copy_is_preserved_and_output_is_bounded(self):
        summary = "Your two dated scale readings form a useful reference alongside your completed workouts."
        action = "Record the next reading with the same scale and testing conditions."
        narrative = {"summary": summary, "wins": ["You recorded completed workouts.", "Extra win"],
                     "focus": [action, "Extra action"]}
        result = self.normalize(narrative, [reading(source="Synthetic scale", method="bia")])
        self.assertEqual(result, {"summary": summary, "wins": [narrative["wins"][0]], "focus": [action]})

    def test_professional_report_actions_are_replaced_without_source_name_matching(self):
        for action in ("Upload another report from your nutritionist.", "Repeat the anthropometric assessment next month.",
                       "Repeat the same measurement method.", "Solicita un nuevo informe antropométrico."):
            with self.subTest(action=action):
                result = self.normalize({"summary": "The dated assessment remains a useful reference.", "focus": [action]}, [reading()])
                self.assertIn("baseline independent", result["focus"][0])
                self.assertNotEqual(result["focus"][0], action)

    def test_known_historical_source_followup_is_replaced_but_factual_mention_is_kept(self):
        summary = "Charlie recorded 80 kg on 2026-10-10."
        entries = [reading(source="Charlie")]
        for action in ("Book another Charlie assessment.", "Go back to Charlie for the next reading.",
                       "Ask Charlie for another measurement.", "Return to Charlie for a new measurement.",
                       "Visit Charlie next week.", "Your next step is needing another Charlie reading.",
                       "Volver a Charlie para la próxima medición.", "Necesitas visitar a Charlie."):
            with self.subTest(action=action):
                result = self.normalize({"summary": summary, "focus": [action]}, entries)
                self.assertEqual(result["summary"], summary)
                self.assertIn("baseline independent", result["focus"][0])
        result = self.normalize({"summary": "You need another Charlie measurement before we can review progress."}, entries)
        self.assertIn("80 kg", result["summary"])
        self.assertNotIn("need another", result["summary"])
        summary = "Charlie remains a historical reference; you do not need another report."
        self.assertEqual(self.normalize({"summary": summary}, entries)["summary"], summary)

    def test_existing_manual_or_scale_series_is_the_next_measurement_option(self):
        historical = reading(day="2025-05-01")
        for method, expected in (("manual", "same technique and measurement site"), ("bia", "same scale and similar conditions")):
            with self.subTest(method=method):
                own = reading("synthetic-current", "2026-10-22", "Synthetic home setup", method, 78)
                result = self.normalize(None, [historical, own])
                self.assertIn(expected, result["focus"][0])
                self.assertIn("78 kg", result["summary"])
                self.assertNotIn("80 kg", result["summary"])

    def test_natural_short_name_for_historical_provider_is_only_an_alias_in_followup_requests(self):
        entries = [reading(source="Charlie Nutrición y Ejercicio")]
        summary = "Charlie recorded 80 kg on 2026-10-10."
        for action in ("Go back to Charlie for your next measurement.", "Return to Charlie next month.",
                       "Book Charlie for another reading.", "Visit Charlie next week.",
                       "You need Charlie for the next measurement.", "Necesitas visitar a Charlie."):
            with self.subTest(action=action):
                result = self.normalize({"summary": summary, "focus": [action]}, entries)
                self.assertEqual(result["summary"], summary)
                self.assertIn("baseline independent", result["focus"][0])
        # A later app-navigation instruction must not turn the earlier dated
        # source mention into a provider follow-up requirement.
        factual = summary + " Visit your progress page to review saved facts."
        self.assertEqual(self.normalize({"summary": factual}, entries)["summary"], factual)
        self.assertEqual(self.normalize({"summary": "Synthetic data remains available.", "focus": ["Visit your synthetic progress page."]},
                                        [reading(source="Synthetic assessment")])["focus"], ["Visit your synthetic progress page."])

    def test_newer_historical_assessment_does_not_replace_current_home_reference(self):
        historical = reading("assessment", "2026-10-23", "Synthetic historical provider", "anthropometric", 80)
        for method in ("manual", "bia"):
            with self.subTest(method=method):
                own = reading("own", "2026-10-20", "Synthetic home setup", method, 78)
                result = self.normalize(None, [historical, own])
                self.assertIn("78 kg", result["summary"])
                self.assertIn("2026-10-20", result["summary"])
                self.assertIn("Synthetic home setup", result["summary"])
                self.assertNotIn("80 kg", result["summary"])
                self.assertNotIn("Synthetic historical provider", result["summary"])
                historical_result = self.normalize(None, [historical])
                self.assertIn("Historical reference", historical_result["summary"])
                self.assertIn("80 kg", historical_result["summary"])

    def test_ongoing_selector_keeps_method_identity_and_leaves_date_validation_to_consumer(self):
        entries = [reading(), reading("bia", "2026-10-22", "Synthetic scale", " BIA "),
                   reading("manual", None, "Synthetic manual", "Manual"),
                   reading("future", "2026-10-24", "Synthetic future", "bia"),
                   reading("unknown", "2026-10-21", "Synthetic unknown", "unknown")]
        before = copy.deepcopy(entries)
        selected = ongoing_tracking_entries(entries)
        self.assertEqual([entry["id"] for entry in selected], ["bia", "manual", "future"])
        self.assertIs(selected[0], entries[1])
        self.assertEqual(entries, before)

    def test_spanish_fallback_reports_evidence_and_has_one_feasible_action(self):
        result = self.normalize({"summary": "Nada que reportar", "focus": []}, [reading()],
                                workouts={"sessions": 1, "completed_sets": 6}, language="es-CR")
        self.assertIn("1 entrenamiento completado y 6 series completadas", result["summary"])
        self.assertIn("Peso 80 kg", result["summary"])
        self.assertIn("referencia independiente", result["focus"][0])
        self.assertNotRegex(result["summary"], r"perdiste grasa|ganaste musculo|causa")

    def test_undated_and_future_values_do_not_become_latest_reading_or_trend(self):
        entries = [reading(), reading("undated", None, value=100), reading("future", "2026-10-24", value=50)]
        result = self.normalize(None, entries)
        self.assertIn("80 kg", result["summary"])
        self.assertNotIn("100 kg", result["summary"])
        self.assertNotIn("50 kg", result["summary"])
        self.assertIn("does not establish a trend", result["summary"])
        result = self.normalize(None, entries[1:])
        self.assertIn("dated measurement", result["summary"])

    def test_only_supplied_comparable_delta_is_shown_without_tissue_claims(self):
        current = reading("latest", "2026-10-22", "Synthetic scale", "bia", 78)
        previous = reading("previous", "2026-10-15", "Synthetic scale", "bia", 80)
        comparison = {"key": "weight_kg", "unit": "kg", "source_name": "Synthetic scale", "method": "bia",
                      "start_date": "2026-10-15", "end_date": "2026-10-22", "start_value": 80, "end_value": 78, "delta": -2}
        result = self.normalize(None, [previous, current], [comparison], {"sessions": 2, "completed_sets": 10})
        self.assertIn("80 → 78 kg", result["summary"])
        self.assertIn("2026-10-15–2026-10-22", result["summary"])
        self.assertNotRegex(result["summary"], r"fat|muscle|caused|per week|%")
        result = self.normalize(None, [previous, current], [{**comparison, "source_name": "Different device"}])
        self.assertNotIn("→", result["summary"])

    def test_context_groups_sources_with_historical_roles_without_retirement_inference(self):
        entries = [reading(), reading("later", "2026-10-12"), reading("future", "2026-10-24"),
                   reading("own", "2026-10-23", "Synthetic home", "manual"),
                   reading("unknown", None, "Synthetic undated", "isak"),
                   reading("unclassified", "2026-10-22", "Unknown setup", "unknown")]
        context = measurement_tracking_context(entries)
        self.assertEqual(len(context["historical_sources"]), 2)
        self.assertEqual(context["historical_sources"][0], {"source_name": "Synthetic assessment", "method": "anthropometric",
            "latest_date": "2026-10-12", "role": "historical_reference", "follow_up_required": False})
        self.assertIsNone(context["historical_sources"][1]["latest_date"])
        self.assertEqual(context["ongoing_sources"], [{"source_name": "Synthetic home", "method": "manual",
            "latest_date": "2026-10-23", "role": "ongoing_tracking_option"}])
        self.assertEqual(context["omitted_sources"], 0)
        self.assertIn("optional, never a requirement", context["policy"])
        self.assertNotIn("retired", repr(context))

    def test_context_limits_each_role_and_discloses_omitted_groups(self):
        entries = [reading(f"h-{index}", source=f"Synthetic historical {index:02d}") for index in range(53)]
        entries += [reading(f"o-{index}", source=f"Synthetic ongoing {index:02d}", method="bia") for index in range(52)]
        context = measurement_tracking_context(entries)
        self.assertEqual(len(context["historical_sources"]), 50)
        self.assertEqual(len(context["ongoing_sources"]), 50)
        self.assertEqual(context["omitted_sources"], 5)

    def test_context_uses_explicit_date_and_excludes_future_only_sources(self):
        context = measurement_tracking_context([
            reading("future", "2026-10-24", "Synthetic future", "bia"),
            reading("undated", None, "Synthetic undated", "manual"),
        ], today=TODAY)
        self.assertEqual(context["historical_sources"], [])
        self.assertEqual(context["ongoing_sources"], [{"source_name": "Synthetic undated", "method": "manual",
            "latest_date": None, "role": "ongoing_tracking_option"}])

    def test_history_and_model_inputs_are_never_mutated(self):
        entries = [reading(), reading("own", "2026-10-23", "Synthetic home", "manual", 79)]
        narrative = {"summary": "Nothing to report", "wins": [], "focus": ["Repeat the assessment."]}
        workouts = {"sessions": 2, "completed_sets": 12}
        profile = {"response_language": "en"}
        inputs = [narrative, entries, [], workouts, profile]
        before = copy.deepcopy(inputs)
        normalize_progress_narrative(*inputs)
        measurement_tracking_context(entries)
        self.assertEqual(inputs, before)


if __name__ == "__main__":
    unittest.main()
