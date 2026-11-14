"""Offline manual chat authorization; no credentials or provider requests."""
from concurrent.futures import ThreadPoolExecutor
from contextvars import copy_context
from datetime import datetime, timezone
import os
from pathlib import Path
import sys
from threading import RLock
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from firebase_functions import https_fn
from lib import qa_manual_chat as manual
from lib import openai_client as ai
from lib import qa_ai_gate as ordinary_gate

UID = "verified-owner"
QA_ENV = {"APP_ENV": "qa", "QA_FIREBASE_PROJECT_ID": manual.QA_PROJECT_ID,
          "GCLOUD_PROJECT": manual.QA_PROJECT_ID, "GOOGLE_CLOUD_PROJECT": manual.QA_PROJECT_ID,
          "AI_MOCK_ENABLED": "0"}
NOW = datetime(2026, 10, 18, 5, 59, tzinfo=timezone.utc)


class Store:
    def __init__(self):
        self.lock, self.writes = RLock(), []
        self.docs = {manual.POLICY_PATH: {"enabled": True, "project_id": manual.QA_PROJECT_ID,
                     "demo_daily_messages": 10, "real_users_unlimited": True, "timezone": "America/Costa_Rica"},
                     f"admins/{UID}": {"role": "owner"}, f"user_status/{UID}": {"status": "approved", "synthetic": True}}
    def document(self, path):
        store = self
        class Ref:
            def get(self, transaction=None):
                if transaction and transaction.writing: raise AssertionError("read after write")
                value = store.docs.get(path)
                return SimpleNamespace(exists=path in store.docs, to_dict=lambda: dict(value) if value is not None else None)
            def set(self, value):
                store.docs[path] = value
                store.writes.append(path)
        return Ref()
    def transaction(self):
        return SimpleNamespace(writing=False, set=lambda ref, value: ref.set(value))
    def transactional(self, function):
        def run(tx):
            with self.lock: return function(tx)
        return run


class ManualChatTests(unittest.TestCase):
    def setUp(self):
        self.db = Store()
        self.context = patch.dict(os.environ, QA_ENV, clear=True)
        self.client = patch.object(manual.fs, "client", return_value=self.db)
        self.tx = patch.object(manual.fs, "transactional", self.db.transactional)
        self.clock = patch.object(manual, "_now", return_value=NOW)
        for value in (self.context, self.client, self.tx, self.clock):
            value.start(); self.addCleanup(value.stop)
        manual.clear_manual_chat_scope()
        self.addCleanup(manual.clear_manual_chat_scope)

    def reason(self, function, expected):
        with self.assertRaises(https_fn.HttpsError) as raised: function()
        self.assertEqual(raised.exception.details, {"reason": expected})

    def test_scope_reserves_one_message_and_two_shared_context_provider_attempts(self):
        with manual.qa_manual_chat_scope(UID):
            first, second, third = copy_context(), copy_context(), copy_context()
            self.assertTrue(first.run(manual.consume_manual_chat_permit, UID, "general"))
            self.assertTrue(second.run(manual.consume_manual_chat_permit, UID, "progress"))
            self.reason(lambda: third.run(manual.consume_manual_chat_permit, UID, "general"), "QA_MANUAL_CHAT_LIMIT")
        self.assertFalse(manual.consume_manual_chat_permit(UID, "general"))
        self.reason(lambda: first.run(manual.consume_manual_chat_permit, UID, "general"), "QA_AI_PAUSED")
        self.assertEqual(self.db.docs[f"{manual.USAGE_COLLECTION}/{UID}_2026-10-17"]["messages"], 1)
        self.assertEqual(len(self.db.writes), 1)

    def test_daily_limit_is_atomic_and_rolls_over_at_costa_rica_midnight(self):
        def attempt(_):
            try:
                with manual.qa_manual_chat_scope(UID): pass
                return True
            except https_fn.HttpsError as error:
                self.assertEqual(error.details["reason"], "QA_MANUAL_CHAT_LIMIT")
                return False
        with ThreadPoolExecutor(max_workers=8) as executor:
            self.assertEqual(sum(executor.map(attempt, range(16))), 10)
        with patch.object(manual, "_now", return_value=datetime(2026, 10, 18, 6, 0, tzinfo=timezone.utc)):
            with manual.qa_manual_chat_scope(UID): pass
        self.assertEqual(self.db.docs[f"{manual.USAGE_COLLECTION}/{UID}_2026-10-18"]["messages"], 1)

    def test_policy_owner_status_uid_and_task_are_rechecked_per_provider(self):
        for change in ("disabled", "category", "status", "uid", "extraction"):
            self.db = Store()
            with patch.object(manual.fs, "client", return_value=self.db), patch.object(manual.fs, "transactional", self.db.transactional):
                with manual.qa_manual_chat_scope(UID):
                    if change == "disabled": self.db.docs[manual.POLICY_PATH]["enabled"] = False
                    elif change == "category": self.db.docs[f"user_status/{UID}"].pop("synthetic")
                    elif change == "status": self.db.docs[f"user_status/{UID}"]["status"] = "pending"
                    self.reason(lambda: manual.consume_manual_chat_permit("different-owner" if change == "uid" else UID,
                                                                        "extraction" if change == "extraction" else "general"), "QA_AI_PAUSED")

    def test_invalid_policy_and_store_failures_cannot_authorize(self):
        for change in ({"demo_daily_messages": True}, {"demo_daily_messages": 11}, {"demo_daily_messages": 0},
                       {"project_id": "another-qa-project"}, {"timezone": "UTC"}):
            self.db.docs[manual.POLICY_PATH] = {**Store().docs[manual.POLICY_PATH], **change}
            self.reason(lambda: self.enter_scope(), "QA_AI_PAUSED")
        with patch.object(manual.fs, "client", side_effect=RuntimeError("PRIVATE_CREDENTIAL")):
            self.reason(lambda: self.enter_scope(), "QA_AI_PAUSED")
        self.assertEqual(self.db.writes, [])

    def enter_scope(self):
        with manual.qa_manual_chat_scope(UID): pass

    def test_failures_reset_marker_and_do_not_refund_an_attempted_message(self):
        with self.assertRaises(ValueError):
            with manual.qa_manual_chat_scope(UID): raise ValueError("provider failed")
        self.assertFalse(manual.consume_manual_chat_permit(UID, "general"))
        self.assertEqual(len(self.db.writes), 1)

    def test_production_is_unchanged_and_inconsistent_qa_is_closed(self):
        with patch.dict(os.environ, {"APP_ENV": "production", "GCLOUD_PROJECT": "ai-training-coach-6880b"}, clear=True), patch.object(manual.fs, "client") as client:
            with manual.qa_manual_chat_scope(UID): self.assertFalse(manual.consume_manual_chat_permit(UID, "general"))
            client.assert_not_called()
        for change in ({"APP_ENV": "production"}, {"GOOGLE_CLOUD_PROJECT": "ai-training-coach-6880b"},
                       {"GCLOUD_PROJECT": "another-qa-project", "GOOGLE_CLOUD_PROJECT": "another-qa-project", "QA_FIREBASE_PROJECT_ID": "another-qa-project"}):
            with patch.dict(os.environ, {**QA_ENV, **change}, clear=True): self.reason(self.enter_scope, "QA_AI_PAUSED")

    def test_adapter_uses_manual_permits_only_inside_authenticated_scope(self):
        create = Mock(return_value=SimpleNamespace(status="completed", output_text="Provider stub"))
        with patch.object(ai, "get_client", return_value=SimpleNamespace(responses=SimpleNamespace(create=create))), \
                patch.object(ai, "_record_ai"), patch.object(ai, "enforce_qa_ai_lease", side_effect=manual._paused()) as ordinary:
            with ai.ai_user_scope(UID), manual.qa_manual_chat_scope(UID):
                self.assertEqual(ai.respond([], task="general"), "Provider stub")
                self.assertEqual(ai.respond([], task="progress"), "Provider stub")
                self.reason(lambda: ai.respond([], task="general"), "QA_MANUAL_CHAT_LIMIT")
            self.reason(lambda: ai.respond([], task="general"), "QA_AI_PAUSED")
            self.assertEqual(create.call_count, 2)
            ordinary.assert_called_once()

    def test_new_user_binding_defensively_clears_manual_marker(self):
        with ai.ai_user_scope(UID), manual.qa_manual_chat_scope(UID):
            ai.set_ai_user("different-user")
            self.assertFalse(manual.consume_manual_chat_permit("different-user", "general"))
        self.assertIsNone(ai._AI_USER.get())

    def test_chat_scope_preserves_valid_operator_lease_for_an_unrelated_or_absent_policy(self):
        fixture_uid = "qa_approved_a"
        now = datetime.now(timezone.utc)
        from datetime import timedelta
        for absent in (False, True):
            self.db = Store()
            if absent: self.db.docs.pop(manual.POLICY_PATH)
            self.db.docs[ordinary_gate.QA_AI_CONTROL_PATH] = {
                "enabled": True, "project_id": manual.QA_PROJECT_ID, "lease_id": "operator-test",
                "issued_at": now - timedelta(seconds=1), "expires_at": now + timedelta(minutes=5),
                "allowed_uids": [fixture_uid], "allowed_tasks": ["general", "progress"], "remaining_calls": 2}
            # Use the actual ordinary gate, with an in-memory transaction adapter.
            def transaction():
                return SimpleNamespace(writing=False, set=lambda ref, value: ref.set(value),
                                       update=lambda ref, changes: ref.set({**ref.get().to_dict(), **changes}))
            self.db.transaction = transaction
            create = Mock(return_value=SimpleNamespace(status="completed", output_text="Leased chat"))
            with patch.object(manual.fs, "client", return_value=self.db), patch.object(manual.fs, "transactional", self.db.transactional), \
                    patch.object(ai, "get_client", return_value=SimpleNamespace(responses=SimpleNamespace(create=create))), patch.object(ai, "_record_ai"):
                with ai.ai_user_scope(fixture_uid), manual.qa_manual_chat_scope(fixture_uid):
                    self.assertEqual(ai.respond([], task="general"), "Leased chat")
                    self.assertEqual(ai.respond([], task="progress"), "Leased chat")
                self.assertEqual(create.call_count, 2)
                self.assertEqual(self.db.docs[ordinary_gate.QA_AI_CONTROL_PATH]["remaining_calls"], 0)
                self.assertFalse(any(path.startswith(manual.USAGE_COLLECTION + "/") for path in self.db.writes))

    def test_unrelated_user_without_an_operator_lease_stays_blocked_before_provider(self):
        create = Mock()
        with ai.ai_user_scope("qa_approved_a"), manual.qa_manual_chat_scope("qa_approved_a"), \
                patch.object(ai, "get_client", create):
            self.reason(lambda: ai.respond([], task="general"), "QA_AI_PAUSED")
        create.assert_not_called()
        self.assertEqual(self.db.writes, [])

    def test_revoked_matching_owner_policy_never_falls_back_to_an_operator_lease(self):
        self.db.docs[manual.POLICY_PATH]["enabled"] = False
        with patch.object(ai, "enforce_qa_ai_lease") as ordinary, patch.object(ai, "get_client") as provider:
            with ai.ai_user_scope(UID): self.reason(self.enter_scope, "QA_AI_PAUSED")
        ordinary.assert_not_called()
        provider.assert_not_called()
        self.assertEqual(self.db.writes, [])

    def test_real_owner_and_verified_invited_user_have_no_daily_counter_or_cap(self):
        status = self.db.docs[f"user_status/{UID}"]
        status.pop("synthetic")
        for invited in (False, True):
            if invited:
                self.db.docs.pop(f"admins/{UID}")
                status.update(email="real@example.com", acquisition="request", invitation_id="a" * 32)
                self.db.docs["invitations/" + "a" * 32] = {"status": "accepted", "accepted_by": UID, "email": "real@example.com"}
            self.db.docs[f"{manual.USAGE_COLLECTION}/{UID}_2026-10-17"] = {"messages": 10, "sentinel": "unchanged"}
            for _ in range(12):
                with manual.qa_manual_chat_scope(UID):
                    self.assertTrue(manual.consume_manual_chat_permit(UID, "general"))
                    self.assertTrue(manual.consume_manual_chat_permit(UID, "progress"))
            self.assertEqual(self.db.docs[f"{manual.USAGE_COLLECTION}/{UID}_2026-10-17"], {"messages": 10, "sentinel": "unchanged"})
            self.assertEqual(self.db.writes, [])

    def test_synthetic_markers_override_owner_and_accepted_invitation(self):
        status = self.db.docs[f"user_status/{UID}"]
        status.pop("synthetic")
        status.update(email="real@example.com", invitation_id="b" * 32)
        self.db.docs["invitations/" + "b" * 32] = {"status": "accepted", "accepted_by": UID, "email": "real@example.com", "synthetic": True}
        for _ in range(10):
            with manual.qa_manual_chat_scope(UID): pass
        self.reason(self.enter_scope, "QA_MANUAL_CHAT_LIMIT")

    def test_unknown_approval_or_forged_invitation_link_does_not_grant_uncapped_chat(self):
        self.db.docs.pop(f"admins/{UID}")
        status = self.db.docs[f"user_status/{UID}"]
        status.pop("synthetic")
        status.update(acquisition="invitation", email="real@example.com", invitation_id="c" * 32)
        for invitation in ({}, {"status": "accepted", "accepted_by": "someone-else", "email": "real@example.com"},
                           {"status": "revoked", "accepted_by": UID, "email": "real@example.com"},
                           {"status": "accepted", "accepted_by": UID, "email": "someone-else@example.com"}):
            self.db.docs["invitations/" + "c" * 32] = invitation
            with manual.qa_manual_chat_scope(UID): self.assertFalse(manual.consume_manual_chat_permit(UID, "general"))
        self.assertEqual(self.db.writes, [])


if __name__ == "__main__": unittest.main()
