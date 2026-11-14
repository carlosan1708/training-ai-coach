"""Serialize real SDK manifests with the exact environment Firebase gives Python.

The CLI replaces the child environment during discovery; it does not inherit
the wrapper's APP_ENV/QA_FIREBASE_PROJECT_ID or load dotenv before importing main.
"""
import copy
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from qa_manifest import discovery_manifest, validate_qa_manifest


class FirebasePythonDiscoveryTests(unittest.TestCase):
    def test_actual_cli_discovery_shape_serializes_bounded_qa_without_a_scheduler(self):
        spec = discovery_manifest("training-coach-qa-20261017")
        validate_qa_manifest(spec)
        endpoints = spec["endpoints"]
        self.assertEqual(len(endpoints), 32)
        self.assertNotIn("usage_cleanup", endpoints)
        for name, value in endpoints.items():
            with self.subTest(endpoint=name):
                self.assertEqual({field: value.get(field) for field in ("minInstances", "maxInstances", "concurrency")},
                                 {"minInstances": 0, "maxInstances": 1, "concurrency": 1})
                self.assertNotIn("scheduleTrigger", value)
        self.assertNotIn("cloudscheduler.googleapis.com", [value["api"] for value in spec["requiredAPIs"]])
        # The deployment preflight must refuse incomplete or more expensive
        # manifests, rather than relying on a successful unit import alone.
        for changes in ({"maxInstances": None}, {"minInstances": 1}, {"concurrency": 80}, {"scheduleTrigger": {}}):
            malformed = copy.deepcopy(spec)
            malformed["endpoints"]["chat"].update(changes)
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                validate_qa_manifest(malformed)

    def test_production_cli_discovery_retains_existing_scheduler_and_scaling_defaults(self):
        spec = discovery_manifest("ai-training-coach-6880b")
        endpoints = spec["endpoints"]
        self.assertEqual(len(endpoints), 33)
        self.assertIn("scheduleTrigger", endpoints["usage_cleanup"])
        for name, value in endpoints.items():
            with self.subTest(endpoint=name):
                self.assertIsNone(value.get("minInstances"))
                self.assertIsNone(value.get("maxInstances"))
                self.assertIsNone(value.get("concurrency"))


if __name__ == "__main__":
    unittest.main()
