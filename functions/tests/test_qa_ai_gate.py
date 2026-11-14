"""Offline enforcement checks; none initialize credentials or call a provider."""
import copy
import os
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from firebase_functions import https_fn
from lib import openai_client as ai
from lib import qa_ai_gate as gate

PROJECT = "training-coach-qa-20261017"
QA_ENV = {"APP_ENV": "qa", "QA_FIREBASE_PROJECT_ID": PROJECT,
          "GCLOUD_PROJECT": PROJECT, "GOOGLE_CLOUD_PROJECT": PROJECT, "AI_MOCK_ENABLED": "0"}
NOW = datetime(2026, 10, 17, 18, tzinfo=timezone.utc)


def lease(**changes):
    return {"enabled": True, "project_id": PROJECT, "lease_id": "manually-opened-test",
            "issued_at": NOW - timedelta(minutes=1), "expires_at": NOW + timedelta(minutes=9),
            "allowed_uids": ["qa_approved_a"], "allowed_tasks": ["general", "extraction", "progress"],
            "remaining_calls": 2, **changes}


class LeaseDatabase:
    def __init__(self, value):
        self.value, self.reads, self.writes = copy.deepcopy(value), 0, 0

    def document(self, path):
        assert path == gate.QA_AI_CONTROL_PATH
        return self

    def get(self, transaction=None):
        self.reads += 1
        return SimpleNamespace(exists=self.value is not None, to_dict=lambda: copy.deepcopy(self.value))

    def transaction(self):
        return self

    def update(self, _ref, changes):
        self.writes += 1
        self.value.update(changes)


class QALeaseValidationTests(unittest.TestCase):
    def validate(self, data, uid="qa_approved_a", task="general"):
        return gate.validate_qa_ai_lease(data, uid=uid, task=task, project_id=PROJECT, now=NOW)

    def test_explicit_short_scoped_lease_is_valid(self):
        self.assertEqual(self.validate(lease()), 2)
        self.assertEqual(self.validate(lease(issued_at=NOW, expires_at=NOW + timedelta(minutes=30), remaining_calls=20)), 20)

    def test_invalid_or_expired_lease_never_grants_access(self):
        changes = [{"enabled": False}, {"enabled": 1}, {"project_id": "ai-training-coach-6880b"},
                   {"lease_id": ""}, {"issued_at": NOW + timedelta(seconds=1)},
                   {"expires_at": NOW}, {"expires_at": NOW + timedelta(minutes=30)},
                   {"issued_at": NOW.replace(tzinfo=None)}, {"allowed_uids": []},
                   {"allowed_uids": ["someone_else"]}, {"allowed_uids": ["qa_approved_a", "qa_approved_a"]},
                   {"allowed_tasks": ["general", "unknown"]}, {"allowed_tasks": ["progress"]},
                   {"remaining_calls": 0}, {"remaining_calls": True}, {"remaining_calls": 21},
                   {"consumed_calls": True}, {"consumed_calls": -1}, {"consumed_calls": 19}]
        for change in changes:
            with self.subTest(change=change), self.assertRaises(https_fn.HttpsError) as raised:
                self.validate(lease(**change))
            self.assertEqual(raised.exception.code, https_fn.FunctionsErrorCode.FAILED_PRECONDITION)
            self.assertEqual(raised.exception.details, {"reason": "QA_AI_PAUSED"})
        with self.assertRaises(https_fn.HttpsError):
            self.validate(None)
        with self.assertRaises(https_fn.HttpsError):
            self.validate(lease(), uid=None)

    def test_mismatched_qa_markers_fail_closed_and_production_bypasses_the_store(self):
        with patch.dict(os.environ, {"APP_ENV": "production", "GCLOUD_PROJECT": "ai-training-coach-6880b"}, clear=True), patch.object(gate.fs, "client") as client:
            gate.enforce_qa_ai_lease(None, "general")
            client.assert_not_called()
        for change in ({"APP_ENV": "production"}, {"QA_FIREBASE_PROJECT_ID": ""},
                       {"GOOGLE_CLOUD_PROJECT": "ai-training-coach-6880b"}):
            with self.subTest(change=change), patch.dict(os.environ, {**QA_ENV, **change}, clear=True), patch.object(gate.fs, "client") as client, self.assertRaises(https_fn.HttpsError):
                gate.enforce_qa_ai_lease("qa_approved_a", "general")
            client.assert_not_called()

    def test_each_real_call_consumes_budget_and_revocation_is_immediate(self):
        now = datetime.now(timezone.utc)
        db = LeaseDatabase(lease(issued_at=now - timedelta(seconds=1), expires_at=now + timedelta(minutes=1)))
        with patch.dict(os.environ, QA_ENV, clear=True), patch.object(gate.fs, "client", return_value=db), patch.object(gate.fs, "transactional", lambda fn: fn):
            gate.enforce_qa_ai_lease("qa_approved_a", "general")
            self.assertEqual(db.value["remaining_calls"], 1)
            gate.enforce_qa_ai_lease("qa_approved_a", "progress")
            self.assertEqual(db.value["remaining_calls"], 0)
            self.assertEqual(db.value["consumed_calls"], 2)
            with self.assertRaises(https_fn.HttpsError):
                gate.enforce_qa_ai_lease("qa_approved_a", "general")
            self.assertEqual((db.reads, db.writes), (3, 2))
            db.value.update(remaining_calls=2, enabled=False)
            with self.assertRaises(https_fn.HttpsError):
                gate.enforce_qa_ai_lease("qa_approved_a", "general")
            self.assertEqual((db.reads, db.writes), (4, 2))

    def test_missing_control_or_store_outage_never_initializes_provider(self):
        for store in (LeaseDatabase(None), RuntimeError("store unavailable")):
            client_patch = patch.object(gate.fs, "client", side_effect=store) if isinstance(store, Exception) else patch.object(gate.fs, "client", return_value=store)
            with self.subTest(store=type(store).__name__), patch.dict(os.environ, QA_ENV, clear=True), client_patch, patch.object(gate.fs, "transactional", lambda fn: fn), patch.object(ai, "get_client") as sdk, patch.object(ai, "_record_ai") as usage:
                for task in ("general", "extraction", "progress"):
                    with self.assertRaises(https_fn.HttpsError):
                        ai.respond([{"role": "user", "content": "test"}], task=task)
                sdk.assert_not_called()
                usage.assert_not_called()

    def test_authorized_requests_call_provider_once_without_opening_a_client_bypass(self):
        now = datetime.now(timezone.utc)
        db = LeaseDatabase(lease(issued_at=now - timedelta(seconds=1), expires_at=now + timedelta(minutes=1), remaining_calls=1))
        create = Mock(return_value=SimpleNamespace(status="completed", output_text="Synthetic provider stub"))
        ai.set_ai_user("qa_approved_a")
        self.addCleanup(lambda: ai.set_ai_user(None))
        with patch.dict(os.environ, QA_ENV, clear=True), patch.object(gate.fs, "client", return_value=db), patch.object(gate.fs, "transactional", lambda fn: fn), patch.object(ai, "get_client", return_value=SimpleNamespace(responses=SimpleNamespace(create=create))), patch.object(ai, "_record_ai"):
            self.assertEqual(ai.make_llm().invoke([]).content, "Synthetic provider stub")
            with self.assertRaises(https_fn.HttpsError):
                ai.make_llm().invoke([])
        create.assert_called_once()

    def test_qa_sdk_has_no_automatic_retries_and_free_mock_does_not_consume_a_lease(self):
        ai.get_client.cache_clear()
        self.addCleanup(ai.get_client.cache_clear)
        constructor = Mock()
        with patch.dict(os.environ, QA_ENV, clear=True), patch.object(ai, "_param", return_value="configured"), patch.dict(sys.modules, {"openai": SimpleNamespace(OpenAI=constructor), "openai.auth": SimpleNamespace(gcp_id_token_provider=Mock())}):
            ai.get_client()
        self.assertEqual(constructor.call_args.kwargs["max_retries"], 0)
        with patch.dict(os.environ, {**QA_ENV, "AI_MOCK_ENABLED": "1"}, clear=True), patch.object(ai, "enforce_qa_ai_lease") as control:
            self.assertIn("Synthetic QA", ai.respond([]))
            control.assert_not_called()


if __name__ == "__main__":
    unittest.main()
