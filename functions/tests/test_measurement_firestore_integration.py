"""Opt-in local Firestore SDK integration, with real transactions and no AI/network cloud.

Run against an isolated standalone emulator, for example:
  FIRESTORE_EMULATOR_HOST=127.0.0.1:8817
  TAC_FIRESTORE_INTEGRATION=1
  python -m unittest discover -s functions/tests -p test_measurement_firestore_integration.py

This calls the real Firebase callable implementations and job worker directly;
it does not claim to test Functions HTTP transport or Eventarc delivery.
"""

import inspect
import os
import sys
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from google.auth.credentials import AnonymousCredentials
from google.cloud.firestore_v1 import Client
from google.cloud.firestore_v1.query import Query
from google.cloud.firestore_v1.types import StructuredQuery
from firebase_functions import https_fn
import measurement_api as api

PROJECT = "demo-training-coach-integration"


@unittest.skipUnless(os.environ.get("TAC_FIRESTORE_INTEGRATION") == "1", "Local Firestore integration is opt-in.")
class RealFirestoreMeasurementTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        host = os.environ.get("FIRESTORE_EMULATOR_HOST", "")
        if host.split(":", 1)[0] not in {"127.0.0.1", "localhost"} or not host.rsplit(":", 1)[-1].isdigit():
            raise RuntimeError("Integration tests require an explicit loopback Firestore emulator.")
        cls.db = Client(project=PROJECT, credentials=AnonymousCredentials())

    @classmethod
    def tearDownClass(cls):
        cls.db.close()

    def setUp(self):
        self.uid = "measurement-it-" + uuid.uuid4().hex
        self.db.document(f"user_status/{self.uid}").set({"status": "approved", "synthetic": True})
        self.db.document(f"users/{self.uid}/profile/data").set({"response_language": "en", "synthetic": True})
        self.clients = patch.object(api.fs, "client", return_value=self.db)
        self.mock_ai = patch.dict(os.environ, {"AI_MOCK_ENABLED": "1", "FUNCTIONS_EMULATOR": "true"})
        self.usage = patch("usage_api.safe_record_usage")
        # Emulator 1.20.4 rejects pure descending __name__ scans although cloud
        # StructuredQuery supports them. Only this known query is shimmed for
        # our tiny isolated fixtures; transactions and all SDK RPCs remain real.
        real_stream = Query.stream
        fixture_uid = self.uid

        def compatible_stream(query, *args, **kwargs):
            orders = query._orders
            if (len(orders) == 1 and orders[0].field.field_path == "__name__"
                    and orders[0].direction == StructuredQuery.Direction.DESCENDING
                    and "/".join(query._parent._path) == f"users/{fixture_uid}/logs"):
                snapshots = list(real_stream(query._parent.order_by("__name__"), *args, **kwargs))
                if len(snapshots) > api.MAX_HISTORY:
                    raise AssertionError("The emulator shim only covers a bounded synthetic fixture.")
                snapshots.sort(key=lambda snapshot: snapshot.id, reverse=True)
                return iter(snapshots[:query._limit])
            return real_stream(query, *args, **kwargs)

        self.query_compat = patch.object(Query, "stream", compatible_stream)
        self.clients.start(); self.mock_ai.start(); self.usage.start(); self.query_compat.start()
        self.addCleanup(self.clients.stop); self.addCleanup(self.mock_ai.stop); self.addCleanup(self.usage.stop)
        self.addCleanup(self.query_compat.stop)

    def tearDown(self):
        # Delete only this known synthetic user's subtree/status in the loopback demo project.
        if self.db.project != PROJECT or not self.uid.startswith("measurement-it-"):
            raise RuntimeError("Refusing cleanup outside the integration fixture namespace.")
        self.db.recursive_delete(self.db.document(f"users/{self.uid}"))
        self.db.document(f"user_status/{self.uid}").delete()

    def call(self, endpoint, data):
        req = SimpleNamespace(auth=SimpleNamespace(uid=self.uid, token={"email_verified": True}), data=data)
        return inspect.unwrap(endpoint)(req)

    def entry(self, value=80, measured_at=None, source="Fixture scale"):
        return {"measured_at": measured_at or api.local_today().isoformat(), "source_name": source, "method": "bia",
                "metrics": [{"key": "weight_kg", "label": "Weight", "value": value, "unit": "kg"}]}

    def test_real_transaction_commits_facts_then_worker_queries_and_finalizes(self):
        undated = {**self.entry(79), "measured_at": None}
        saved = self.call(api.save_measurement_entries, {"entries": [self.entry(), undated], "requestId": uuid.uuid4().hex})
        job_ref = self.db.document(f"users/{self.uid}/measurement_jobs/{saved['job_id']}")
        self.assertEqual(job_ref.get().to_dict()["status"], "pending")
        self.assertEqual(len(list(self.db.collection(f"users/{self.uid}/measurement_entries").stream())), 2)
        api.process_measurement_job(self.uid, saved["job_id"], self.db)
        self.assertEqual(job_ref.get().to_dict()["status"], "ready", job_ref.get().to_dict())
        workspace = self.call(api.get_measurement_workspace, {})
        self.assertEqual(workspace["memory"]["status"], "ready")
        self.assertEqual(workspace["insights"]["status"], "ready")
        self.assertTrue(all(entry.get("summary_status") == "ready" for entry in workspace["entries"]))

    def test_concurrent_request_delivery_creates_one_revision_and_one_reading(self):
        request = {"entries": [self.entry()], "requestId": uuid.uuid4().hex}
        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = [executor.submit(self.call, api.save_measurement_entries, request) for _ in range(2)]
            results = []
            for future in futures:
                try:
                    results.append(future.result(timeout=30))
                except https_fn.HttpsError as error:
                    self.assertEqual(error.code, https_fn.FunctionsErrorCode.ABORTED)
                    results.append(None)
        # The emulator may lock-timeout both simultaneous upgrades. An actual
        # retry with the same request ID must recover without duplicating facts.
        results = [result or self.call(api.save_measurement_entries, request) for result in results]
        self.assertEqual(results[0], results[1])
        state = self.db.document(f"users/{self.uid}/measurement_state/current").get().to_dict()
        self.assertEqual(state["revision"], 1)
        self.assertEqual(len(list(self.db.collection(f"users/{self.uid}/measurement_entries").stream())), 1)

    def test_real_delete_during_generation_rejects_late_output(self):
        saved = self.call(api.save_measurement_entries, {"entries": [self.entry()], "requestId": uuid.uuid4().hex})
        original = api._narrative

        def delete_during_generation(*args):
            self.call(api.delete_measurement_entry, {"entryId": saved["entry_ids"][0], "requestId": uuid.uuid4().hex})
            return original(*args)

        with patch.object(api, "_narrative", side_effect=delete_during_generation):
            api.process_measurement_job(self.uid, saved["job_id"], self.db)
        self.assertEqual(self.db.document(f"users/{self.uid}/measurement_jobs/{saved['job_id']}").get().to_dict()["status"], "stale")
        self.assertFalse(self.db.document(f"users/{self.uid}/progress_insights/{saved['job_id']}").get().exists)
        self.assertFalse(self.db.document(f"users/{self.uid}/measurement_entries/{saved['entry_ids'][0]}").get().exists)

    def test_context_reads_imported_facts_without_recent_logs_and_rechecks_workout_edits(self):
        saved = self.call(api.save_measurement_entries, {"entries": [self.entry(78)], "requestId": uuid.uuid4().hex})
        session_ref = self.db.document(f"users/{self.uid}/workout_sessions/completed-fixture")
        session_ref.set({"date": api.local_today().isoformat(), "status": "completed", "exercises": [
            {"name": "Squat", "sets": [{"done": True, "reps": 10, "weight_kg": 20}]}]})
        api.process_measurement_job(self.uid, saved["job_id"], self.db)
        context = api.measurement_context(self.uid, self.db)
        self.assertEqual(context["measurements"][0]["metrics"][0]["value"], 78)
        self.assertEqual(context["workouts"]["total_volume_kg"], 200)
        self.assertTrue(context["memory"])
        active_ref = self.db.document(f"users/{self.uid}/workout_sessions/active-fixture")
        active_ref.set({"date": api.local_today().isoformat(), "status": "active", "exercises": []})
        self.assertTrue(api.measurement_context(self.uid, self.db)["memory"])
        active_ref.update({"exercises": [{"name": "Squat", "sets": [{"done": True, "reps": 10, "weight_kg": 90}]}]})
        self.assertTrue(api.measurement_context(self.uid, self.db)["memory"])
        session_ref.update({"exercises": [{"name": "Squat", "sets": [{"done": True, "reps": 10, "weight_kg": 30}]}]})
        fresh = api.measurement_context(self.uid, self.db)
        self.assertEqual(fresh["workouts"]["total_volume_kg"], 300)
        self.assertEqual(fresh["memory"], "")

    def test_weekly_report_uses_imported_comparable_weights_and_real_completed_sets(self):
        import main
        today = api.local_today()
        self.call(api.save_measurement_entries, {"entries": [
            self.entry(100, (today - timedelta(days=6)).isoformat(), "Older scale"),
            self.entry(73, (today - timedelta(days=1)).isoformat(), "New scale"),
            self.entry(70, today.isoformat(), "New scale"), self.entry(72, today.isoformat(), "New scale")], "requestId": uuid.uuid4().hex})
        self.db.document(f"users/{self.uid}/workout_sessions/week-fixture").set({"date": today.isoformat(), "status": "completed", "total_volume_kg": 999999,
            "exercises": [{"name": "Squat", "sets": [{"done": True, "reps": 5, "weight_kg": 40}]}]})
        stats = main._week_stats(self.uid, self.db)
        self.assertEqual(stats["weight_start_kg"], 73)
        self.assertEqual(stats["weight_end_kg"], 71)
        self.assertEqual(stats["weight_delta_kg"], -2)
        self.assertEqual(stats["weight_source"]["source_name"], "New scale")
        self.assertEqual(stats["total_volume_kg"], 200)


if __name__ == "__main__":
    unittest.main()
