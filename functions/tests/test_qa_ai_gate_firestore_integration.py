"""Opt-in loopback Firestore SDK test for atomic QA request budgets, with no model."""
import os
import sys
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from firebase_functions import https_fn
from google.auth.credentials import AnonymousCredentials
from google.cloud.firestore_v1 import Client
from lib import qa_ai_gate as gate

PROJECT = "demo-training-coach-qa-gate"


@unittest.skipUnless(os.environ.get("TAC_FIRESTORE_INTEGRATION") == "1", "Local Firestore integration is opt-in.")
class RealFirestoreQAGateTests(unittest.TestCase):
    def test_concurrent_claims_cannot_exceed_one_explicit_permit(self):
        host = os.environ.get("FIRESTORE_EMULATOR_HOST", "")
        if host.split(":", 1)[0] not in {"127.0.0.1", "localhost"} or not host.rsplit(":", 1)[-1].isdigit():
            raise RuntimeError("Integration tests require an explicit loopback Firestore emulator.")
        db = Client(project=PROJECT, credentials=AnonymousCredentials())
        self.addCleanup(db.close)
        ref = db.document(gate.QA_AI_CONTROL_PATH)
        lease_id = "gate-it-" + uuid.uuid4().hex
        now = datetime.now(timezone.utc)
        ref.set({"enabled": True, "project_id": PROJECT, "lease_id": lease_id,
                 "issued_at": now - timedelta(seconds=1), "expires_at": now + timedelta(minutes=5),
                 "allowed_uids": ["synthetic"], "allowed_tasks": ["general"], "remaining_calls": 1})

        def cleanup():
            if db.project != PROJECT:
                raise RuntimeError("Refusing cleanup outside the isolated emulator project.")
            value = ref.get().to_dict() or {}
            if value.get("lease_id") == lease_id:
                ref.delete()

        self.addCleanup(cleanup)
        env = {"APP_ENV": "qa", "QA_FIREBASE_PROJECT_ID": PROJECT, "GCLOUD_PROJECT": PROJECT,
               "GOOGLE_CLOUD_PROJECT": PROJECT}

        def claim():
            try:
                gate.enforce_qa_ai_lease("synthetic", "general")
                return True
            except https_fn.HttpsError as error:
                self.assertEqual(error.details, {"reason": "QA_AI_PAUSED"})
                return False

        # All Firestore SDK transaction logic is real; only the client origin is
        # redirected to a named local demo project with anonymous credentials.
        with patch.dict(os.environ, env), patch.object(gate.fs, "client", return_value=db):
            with ThreadPoolExecutor(max_workers=2) as executor:
                results = list(executor.map(lambda _: claim(), range(2)))
            self.assertLessEqual(sum(results), 1)
            state = ref.get().to_dict()
            self.assertIn(state["remaining_calls"], (0, 1))
            if state["remaining_calls"] == 1:
                # Some emulator versions abort both simultaneous lock upgrades.
                # A later explicit retry must recover, never duplicate a permit.
                self.assertTrue(claim())
            self.assertFalse(claim())
            state = ref.get().to_dict()
            self.assertEqual((state["remaining_calls"], state["consumed_calls"]), (0, 1))
            # A fresh lease can be revoked immediately, without positive caches.
            ref.update({"remaining_calls": 1, "consumed_calls": 0, "enabled": False})
            self.assertFalse(claim())
            self.assertEqual(ref.get().to_dict()["remaining_calls"], 1)


if __name__ == "__main__":
    unittest.main()
