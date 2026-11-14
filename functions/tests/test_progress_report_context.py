"""Historical-source policy reaches reports without rewriting measurement history."""
import copy
import inspect
import json
import sys
import unittest
from datetime import date
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import measurement_api as api
from lib.measurements import factual_progress_digest, normalize_entry, source_fingerprint, workout_rollup
from test_measurements import FakeDB, observation


class ProgressReportContextTests(unittest.TestCase):
    def setUp(self):
        self.db = FakeDB()
        self.profile = {"response_language": "en", "training_goal": "general"}
        self.db.docs["users/u/profile/data"] = self.profile
        self.entries = [
            {**normalize_entry({**observation(82, "2025-01-01", "Charlie"), "method": "anthropometric"}), "id": "old"},
            {**normalize_entry(observation(78, "2026-10-17", "Own scale")), "id": "current"},
        ]
        for entry in self.entries:
            self.db.docs[f"users/u/measurement_entries/{entry['id']}"] = copy.deepcopy(entry)

    def test_prompt_has_historical_roles_and_does_not_require_repeat_reports(self):
        before = copy.deepcopy(self.entries)
        historical_delta = {"method": "anthropometric", "source_name": "Charlie", "key": "weight_kg", "delta": -1}
        current_delta = {"method": "bia", "source_name": "Own scale", "key": "weight_kg", "delta": -0.2}
        with patch.object(api, "mock_enabled", return_value=False), patch.object(api, "respond", return_value={}) as provider:
            api._narrative([], [], [historical_delta, current_delta], {"sessions": 2}, self.profile, False, self.entries)
        prompt = provider.call_args.args[0][0]["content"]
        facts = json.loads(prompt.split("\n", 1)[1])
        historical = facts["tracking_context"]["historical_sources"]
        self.assertEqual(historical[0]["source_name"], "Charlie")
        self.assertFalse(historical[0]["follow_up_required"])
        self.assertEqual(facts["calculated_comparisons"], [current_delta])
        self.assertEqual(facts["historical_comparisons"], [historical_delta])
        self.assertEqual([entry["source_name"] for entry in facts["ongoing_tracking_observations"]], ["Own scale"])
        self.assertEqual(facts["confirmed_observations"][0]["metrics"][0]["value"], 82)
        self.assertIn("never ask for another report", prompt)
        self.assertIn("never say 'nothing to report'", prompt)
        self.assertIn("must not drive current advice", prompt)
        self.assertEqual(self.entries, before)

    def test_saved_dismissive_report_is_repaired_on_read_without_model_or_data_writes(self):
        self.db.docs["users/u/progress_insights/saved"] = {
            "revision": 0, "days": 90, "summary": "Nothing to report.", "wins": [],
            "focus": ["Book another Charlie assessment."], "comparisons": [],
            "workouts": workout_rollup([], 90), "source_fingerprint": source_fingerprint(self.entries),
        }
        before = copy.deepcopy(self.db.docs)
        with patch.object(api, "require_approved", return_value="u"), patch.object(api.fs, "client", return_value=self.db), \
                patch.object(api, "_history", return_value=(self.entries, False)), \
                patch.object(api, "_all_progress_sessions", return_value=([], False)), \
                patch.object(api, "_sessions", return_value=[]), \
                patch.object(api, "respond", side_effect=AssertionError("No model call on a report read")):
            result = inspect.unwrap(api.get_measurement_workspace)(SimpleNamespace(data={"section": "summary"}))
        insight = result["insights"]
        self.assertEqual(insight["status"], "ready")
        self.assertNotIn("nothing to report", insight["summary"].lower())
        self.assertEqual(len(insight["focus"]), 1)
        self.assertNotIn("Charlie", insight["focus"][0])
        self.assertEqual(insight["tracking_context"]["historical_sources"][0]["source_name"], "Charlie")
        self.assertEqual(self.db.docs, before)

    def test_factual_history_labels_reference_and_preserves_separate_baselines(self):
        for lang, expected in (("en", "Historical references: Charlie"), ("es", "Referencias históricas: Charlie")):
            with self.subTest(lang=lang):
                before = copy.deepcopy(self.entries)
                digest = factual_progress_digest(self.entries, today=date(2026, 10, 23), language=lang)
                self.assertIn(expected, digest["summary"])
                self.assertEqual(digest["counts"]["observations"], 2)
                self.assertEqual(len(digest["metrics"]), 2)
                self.assertTrue(all(metric["delta"] is None for metric in digest["metrics"]))
                self.assertEqual(digest["narrative_version"], 3)
                self.assertEqual(self.entries, before)

    def test_older_saved_coaching_cannot_keep_using_assessments_to_drive_current_targets(self):
        self.db.docs["users/u/progress_insights/saved"] = {
            "revision": 0, "days": 90, "summary": "Use Charlie's past assessment to set your current target.",
            "wins": [], "focus": ["Increase the target based on Charlie's result."], "comparisons": [],
            "workouts": workout_rollup([], 90), "source_fingerprint": source_fingerprint(self.entries),
        }
        before = copy.deepcopy(self.db.docs)
        with patch.object(api, "require_approved", return_value="u"), patch.object(api.fs, "client", return_value=self.db), \
                patch.object(api, "_history", return_value=(self.entries, False)), \
                patch.object(api, "_all_progress_sessions", return_value=([], False)), \
                patch.object(api, "_sessions", return_value=[]), \
                patch.object(api, "respond", side_effect=AssertionError("No model call on a report read")):
            result = inspect.unwrap(api.get_measurement_workspace)(SimpleNamespace(data={"section": "summary"}))
        self.assertIn("Own scale", result["insights"]["summary"])
        self.assertNotIn("Charlie", result["insights"]["summary"])
        self.assertNotIn("Charlie", result["insights"]["focus"][0])
        self.assertEqual(self.db.docs, before)


if __name__ == "__main__":
    unittest.main()
