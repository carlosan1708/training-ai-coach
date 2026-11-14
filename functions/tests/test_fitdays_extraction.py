"""Synthetic Fitdays image contract checks; no personal fixture or model/OCR call.

The structured provider result is mocked. These test image transport, semantics,
normalization and the review boundary, not the accuracy of a vision model.
"""
import inspect
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib.measurements import canonical_metric_key, non_observation_metric, normalize_entry, normalize_metric
from test_measurements import FakeDB
import measurement_api as api


def metric(key, label, value, unit):
    return {"key": key, "label": label, "value": value, "unit": unit, "raw_value": str(value),
            "raw_unit": unit, "confidence": "high", "evidence": f"Synthetic result tile: {label} {value} {unit}"}


class FitdaysImageContractTests(unittest.TestCase):
    def parse_image(self, metrics, measured_at="2026-10-01"):
        db = FakeDB()
        # Only the signature is needed: vision itself is replaced by the
        # explicit provider fixture, never a claim of extracted real pixels.
        raw = b"\xff\xd8\xffsynthetic-image-fixture"
        blob = SimpleNamespace(size=len(raw), content_type="image/jpeg", generation="42", reload=Mock(),
                               download_as_bytes=Mock(return_value=raw))
        provider = {"entries": [{"measured_at": measured_at, "source_name": "Fitdays synthetic scale", "method": "bia",
                                  "notes": "Synthetic printed time 08:05; timezone unspecified. Body type: balanced.", "metrics": metrics}], "warnings": []}
        with patch.object(api, "require_approved", return_value="u"), patch.object(api.fs, "client", return_value=db), \
                patch.object(api.storage, "bucket", return_value=SimpleNamespace(blob=Mock(return_value=blob))), \
                patch.object(api, "mock_enabled", return_value=False), patch.object(api, "respond", return_value=provider) as respond:
            result = inspect.unwrap(api.parse_measurement_import)(SimpleNamespace(data={"storagePath": "users/u/measurement_imports/synthetic.jpg"}))
        image = respond.call_args.args[0][1]["content"][0]
        self.assertEqual(image["type"], "input_image")
        self.assertTrue(image["image_url"].startswith("data:image/jpeg;base64,"))
        blob.download_as_bytes.assert_called_once_with(if_generation_match=42)
        self.assertEqual(result["status"], "review")
        self.assertFalse(any("/measurement_entries/" in path for path in db.docs))
        return result

    def test_total_skeletal_and_lean_values_keep_explicit_mass_and_percent_distinct(self):
        values = [metric("weight_kg", "Peso", 72, "kg"),
                  metric("muscle_mass", "Masa muscular", 54.2, "kg"), metric("muscle_mass", "Tasa muscular", 75.3, "%"),
                  metric("skeletal_muscle", "Músculo esquelético", 31.2, "kg"), metric("skeletal_muscle", "Músculo esquelético", 43.3, "%"),
                  metric("fat_free_mass", "Peso corporal sin grasa", 58.9, "kg"),
                  metric("body_fat", "Grasa corporal", 18.2, "%"), metric("body_fat", "Masa grasa", 13.1, "kg"),
                  metric("body_water", "Agua corporal", 59, "%"), metric("body_water", "Agua corporal", 42.5, "kg"),
                  metric("protein", "Proteína", 17.4, "%"), metric("bone_mass_kg", "Masa ósea", 3, "kg"),
                  metric("bmr_kcal", "Metabolismo basal", 1700, "kcal/day"),
                  metric("visceral_fat_level", "Grasa visceral", 5, "index"),
                  metric("subcutaneous_fat_pct", "Grasa subcutánea", 12.3, "%"),
                  metric("metabolic_age", "Edad corporal", 36, "years"),
                  metric("device_phase_angle", "Ángulo de fase", 5.2, "degrees")]
        draft = self.parse_image(values)
        entry = normalize_entry(draft["entries"][0])
        saved = {value["key"]: value for value in entry["metrics"]}
        self.assertEqual(len(saved), len(values))
        for key, value in {"muscle_mass_kg": 54.2, "muscle_mass_pct": 75.3, "skeletal_muscle_kg": 31.2,
                           "skeletal_muscle_pct": 43.3, "lean_mass_kg": 58.9, "body_fat_pct": 18.2,
                           "body_fat_kg": 13.1, "body_water_pct": 59, "body_water_kg": 42.5, "protein_pct": 17.4}.items():
            self.assertEqual(saved[key]["value"], value)
        self.assertEqual(saved["device_phase_angle"]["unit"], "degrees")
        self.assertEqual(saved["device_phase_angle"]["raw_value"], "5.2")
        self.assertIn("Ángulo de fase", saved["device_phase_angle"]["evidence"])
        self.assertIn("timezone unspecified", entry["notes"])

    def test_explicit_control_targets_and_reference_ranges_do_not_become_observations(self):
        draft = self.parse_image([metric("weight_kg", "Peso", 72, "kg"),
                                  metric("recommended_weight_kg", "Peso recomendado", 65, "kg"),
                                  metric("muscle_to_gain_kg", "Control muscular", -1.2, "kg"),
                                  metric("reference_range_body_fat_low", "Reference range", 10, "%"),
                                  metric("device_balance_score", "Balance score", 81, "points")])
        self.assertEqual([value["key"] for value in draft["entries"][0]["metrics"]], ["weight_kg", "device_balance_score"])
        self.assertTrue(any("target or reference" in value for value in draft["warnings"]))
        self.assertFalse(non_observation_metric(metric("target_tracking_accuracy", "Tracking accuracy", 90, "points")))

    def test_explicit_wrong_units_remain_reviewable_and_no_missing_date_is_fabricated(self):
        draft = self.parse_image([metric("skeletal_muscle_kg", "Músculo esquelético", 43.3, "%"),
                                  metric("muscle_mass", "Masa muscular", 54.2, "")], measured_at=None)
        entry = draft["entries"][0]
        self.assertIsNone(entry["measured_at"])
        self.assertTrue(all(value["key"].startswith("unmapped_") for value in entry["metrics"]))
        self.assertEqual([(value["value"], value["unit"], value["confidence"]) for value in entry["metrics"]], [(43.3, "%", "low"), (54.2, "", "low")])
        self.assertTrue(any("date is missing" in value for value in draft["warnings"]))
        with self.assertRaises(ValueError):
            normalize_metric(metric("muscle_mass_kg", "Total muscle", 75.3, "%"))
        self.assertEqual(canonical_metric_key(metric("musculo_esqueletico", "Músculo esquelético", 43.3, "%")), "skeletal_muscle_pct")
        corrected = normalize_metric({**metric("muscle_mass_kg", "Total muscle", 54.2, "kg"), "raw_unit": ""})
        self.assertEqual(corrected["raw_unit"], "")  # Review corrections do not invent original source units.


if __name__ == "__main__":
    unittest.main()
