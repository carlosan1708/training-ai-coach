"""Real compiled chat graphs with local policy/usage fixtures and a stub provider."""
import inspect
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from firebase_functions import https_fn
from test_measurements import FakeDB, Transaction
from lib import openai_client as ai
from lib import qa_manual_chat as manual
from lib.access import require_approved
import access_api
import main

PROJECT = "training-coach-qa-20261017"
ENV = {"APP_ENV": "qa", "QA_FIREBASE_PROJECT_ID": PROJECT, "GCLOUD_PROJECT": PROJECT,
       "GOOGLE_CLOUD_PROJECT": PROJECT, "AI_MOCK_ENABLED": "0"}


class ChatTransaction(Transaction):
    def create(self, ref, data):
        if ref.get().exists:
            raise AssertionError("Duplicate quota document")
        ref.set(data)


class ChatScopeTests(unittest.TestCase):
    def setUp(self):
        self.db = FakeDB()
        self.db.transaction = lambda: ChatTransaction()
        self.db.docs.update({"admins/u": {"role": "owner"}, "users/u/profile/data": {"response_language": "es"},
            "runtime_controls/qa_ai": {"enabled": False},
            "runtime_controls/qa_manual_chat": {"enabled": True, "project_id": PROJECT,
                "demo_daily_messages": 10, "real_users_unlimited": True, "timezone": "America/Costa_Rica"}})
        for replacement in (patch.dict(os.environ, ENV, clear=True), patch.object(main, "require_approved", require_approved),
                            patch.object(main.fs, "client", return_value=self.db), patch.object(main.fs, "transactional", lambda fn: fn),
                            patch.object(ai, "_record_ai")):
            replacement.start(); self.addCleanup(replacement.stop)
        self.outer_user = ai._AI_USER.set("outer-context")
        self.addCleanup(lambda: ai._AI_USER.reset(self.outer_user))

    def call(self, data=None, uid="u"):
        req = SimpleNamespace(auth=SimpleNamespace(uid=uid), data=data if data is not None else {"message": "Synthetic question"})
        return inspect.unwrap(main.chat)(req)

    def accepted_invitee(self, *, uid="invited-user", synthetic=False):
        """Use the real acceptance route rather than inventing invitation fields."""
        email = "invited-person@example.test"
        invitation_id = "a" * 32
        token = invitation_id + ".synthetic-local-token"
        now = datetime.now(timezone.utc)
        self.db.docs[f"user_status/{uid}"] = {"status": "pending", "email": email, "acquisition": "request",
            **({"synthetic": True, "is_test": True, "qa_run_id": "offline-run"} if synthetic else {})}
        self.db.docs[f"invitations/{invitation_id}"] = {
            "email": email, "status": "pending", "token_hash": access_api._digest(token),
            "expires_at": now + timedelta(days=1), "created_at": now,
        }
        req = SimpleNamespace(auth=SimpleNamespace(uid=uid, token={"email": email, "email_verified": True,
            "firebase": {"sign_in_provider": "google.com"}}), data={"token": token})
        with patch.object(access_api, "_audit"):
            self.assertEqual(inspect.unwrap(access_api.accept_invitation)(req), {"status": "approved"})
        self.assertEqual(self.db.docs[f"user_status/{uid}"]["acquisition"], "request")
        self.assertEqual(self.db.docs[f"invitations/{invitation_id}"]["accepted_by"], uid)
        return uid, invitation_id

    def provider(self, route="general"):
        def output(**arguments):
            inputs = arguments["input"]
            content = str(inputs[0]["content"]) if inputs else ""
            text = route if "Classify this health coaching message" in content else json.dumps({"reply": "Synthetic graph reply", "memory_updates": []})
            return SimpleNamespace(status="completed", output_text=text)
        return Mock(side_effect=output)

    def assert_scope_closed(self):
        self.assertEqual(ai._AI_USER.get(), "outer-context")
        self.assertFalse(manual.consume_manual_chat_permit("u", "progress"))

    def test_actual_general_and_health_graphs_get_two_calls_without_opening_automatic_ai(self):
        for route in ("general", "health"):
            provider = self.provider(route)
            client = SimpleNamespace(responses=SimpleNamespace(create=provider))
            with self.subTest(route=route), patch.object(ai, "get_client", return_value=client):
                self.assertEqual(self.call()["reply"], "Synthetic graph reply")
                self.assertEqual(provider.call_count, 2)
                models = [call.kwargs["model"] for call in provider.call_args_list]
                self.assertEqual(models[0], ai.OPENAI_GENERAL_MODEL.value)
                self.assertEqual(models[1], (ai.OPENAI_ANALYSIS_MODEL if route == "health" else ai.OPENAI_GENERAL_MODEL).value)
                self.assert_scope_closed()
                with ai.ai_user_scope("u"), self.assertRaises(https_fn.HttpsError) as blocked:
                    ai.respond([{"role": "user", "content": "Automatic progress review"}], task="progress")
                self.assertEqual(blocked.exception.details, {"reason": "QA_AI_PAUSED"})
                self.assertEqual(provider.call_count, 2)
        self.assertEqual(self.db.docs["runtime_controls/qa_ai"], {"enabled": False})
        self.assertFalse(any("measurement_jobs" in path for path in self.db.docs))

    def test_invalid_chat_reserves_nothing_and_provider_failure_unwinds_both_contexts(self):
        provider = Mock(side_effect=RuntimeError("Synthetic provider outage"))
        with patch.object(ai, "get_client", return_value=SimpleNamespace(responses=SimpleNamespace(create=provider))):
            for data in ({"message": " "}, {"message": 123}, {"message": "test", "sessionId": "invalid/path"}):
                with self.assertRaises(https_fn.HttpsError): self.call(data)
                self.assert_scope_closed()
            self.assertFalse(any(path.startswith("qa_manual_chat_usage/") for path in self.db.docs))
            with self.assertRaises(https_fn.HttpsError): self.call()
            self.assertEqual(provider.call_count, 1)
            self.assert_scope_closed()
            with ai.ai_user_scope("u"), self.assertRaises(https_fn.HttpsError):
                ai.respond([], task="general")
            self.assertEqual(provider.call_count, 1)

    def test_ten_demo_messages_are_bounded_and_eleventh_never_calls_provider(self):
        # Server-owned demo markers take precedence even for an owner role.
        self.db.docs["user_status/u"].update({"synthetic": True, "is_test": True, "qa_run_id": "offline-run"})
        provider = self.provider()
        with patch.object(ai, "get_client", return_value=SimpleNamespace(responses=SimpleNamespace(create=provider))):
            for _ in range(10):
                self.assertEqual(self.call()["reply"], "Synthetic graph reply")
            self.assertEqual(provider.call_count, 20)
            with self.assertRaises(https_fn.HttpsError) as limited: self.call()
            self.assertEqual(limited.exception.details, {"reason": "QA_MANUAL_CHAT_LIMIT"})
            self.assertEqual(provider.call_count, 20)
            self.assert_scope_closed()

    def test_real_owner_can_chat_after_message_eleven_with_automatic_ai_closed(self):
        # The previous owner policy may already have exhausted today's quota.
        # Reclassifying as real must not keep that old daily cap in effect.
        now = datetime.now(timezone.utc)
        day = (now - timedelta(hours=6)).date().isoformat()
        old_usage_path = f"qa_manual_chat_usage/u_{day}"
        old_usage = {"project_id": PROJECT, "uid": "u", "date": day, "messages": 10}
        self.db.docs[old_usage_path] = dict(old_usage)
        provider = self.provider("health")
        with patch.object(manual, "_now", return_value=now), \
                patch.object(ai, "get_client", return_value=SimpleNamespace(responses=SimpleNamespace(create=provider))):
            for _ in range(12):
                self.assertEqual(self.call()["reply"], "Synthetic graph reply")
                self.assert_scope_closed()
            self.assertEqual(provider.call_count, 24)
            with ai.ai_user_scope("u"), self.assertRaises(https_fn.HttpsError) as blocked:
                ai.respond([], task="progress")
            self.assertEqual(blocked.exception.details, {"reason": "QA_AI_PAUSED"})
        self.assertEqual(self.db.docs[old_usage_path], old_usage)
        self.assertEqual(sum(path.startswith("qa_manual_chat_usage/") for path in self.db.docs), 1)
        self.assertEqual(self.db.docs["runtime_controls/qa_ai"], {"enabled": False})

    def test_real_accepted_invitee_can_chat_after_message_eleven_without_an_owner_role(self):
        uid, _ = self.accepted_invitee()
        self.assertNotIn(f"admins/{uid}", self.db.docs)
        provider = self.provider("health")
        with patch.object(ai, "get_client", return_value=SimpleNamespace(responses=SimpleNamespace(create=provider))):
            for _ in range(12):
                self.assertEqual(self.call(uid=uid)["reply"], "Synthetic graph reply")
                self.assert_scope_closed()
            self.assertEqual(provider.call_count, 24)
            with ai.ai_user_scope(uid), self.assertRaises(https_fn.HttpsError) as blocked:
                ai.respond([], task="general")
            self.assertEqual(blocked.exception.details, {"reason": "QA_AI_PAUSED"})
        self.assertFalse(any(path.startswith("qa_manual_chat_usage/") for path in self.db.docs))
        self.assertEqual(self.db.docs["runtime_controls/qa_ai"], {"enabled": False})

    def test_accepting_an_invitation_does_not_uncap_a_synthetic_account(self):
        uid, _ = self.accepted_invitee(synthetic=True)
        self.assertTrue(self.db.docs[f"user_status/{uid}"]["synthetic"])
        provider = self.provider()
        with patch.object(ai, "get_client", return_value=SimpleNamespace(responses=SimpleNamespace(create=provider))):
            for _ in range(10): self.assertEqual(self.call(uid=uid)["reply"], "Synthetic graph reply")
            with self.assertRaises(https_fn.HttpsError) as limited: self.call(uid=uid)
        self.assertEqual(limited.exception.details, {"reason": "QA_MANUAL_CHAT_LIMIT"})
        self.assertEqual(provider.call_count, 20)
        usage = [value for path, value in self.db.docs.items() if path.startswith("qa_manual_chat_usage/")]
        self.assertEqual([value["messages"] for value in usage], [10])
        self.assert_scope_closed()

    def test_pending_rejected_and_invalid_invitation_links_never_reach_provider(self):
        provider = self.provider()
        with patch.object(ai, "get_client", return_value=SimpleNamespace(responses=SimpleNamespace(create=provider))):
            for status in ("pending", "rejected"):
                uid, _ = self.accepted_invitee()
                self.db.docs[f"user_status/{uid}"]["status"] = status
                with self.subTest(status=status), self.assertRaises(https_fn.HttpsError): self.call(uid=uid)
                self.assert_scope_closed()
            for change in ({"status": "pending"}, {"status": "revoked"}, {"accepted_by": "different-user"},
                           {"email": "different-person@example.test"}):
                uid, invitation_id = self.accepted_invitee()
                self.db.docs[f"invitations/{invitation_id}"].update(change)
                with self.subTest(invitation=change), self.assertRaises(https_fn.HttpsError): self.call(uid=uid)
                self.assert_scope_closed()
        self.assertEqual(provider.call_count, 0)
        self.assertFalse(any(path.startswith("qa_manual_chat_usage/") for path in self.db.docs))

    def test_invitation_revocation_between_compiled_nodes_blocks_the_answer(self):
        uid, invitation_id = self.accepted_invitee()
        def router_then_revoke(**arguments):
            self.db.docs[f"invitations/{invitation_id}"]["status"] = "revoked"
            return SimpleNamespace(status="completed", output_text="health")
        provider = Mock(side_effect=router_then_revoke)
        with patch.object(ai, "get_client", return_value=SimpleNamespace(responses=SimpleNamespace(create=provider))):
            with self.assertRaises(https_fn.HttpsError) as blocked: self.call(uid=uid)
        self.assertEqual(blocked.exception.details, {"reason": "QA_AI_PAUSED"})
        self.assertEqual(provider.call_count, 1)
        self.assert_scope_closed()

    def test_client_manual_flag_on_other_callable_cannot_open_chat_allowance(self):
        provider = self.provider()
        req = SimpleNamespace(auth=SimpleNamespace(uid="u"),
                              data={"focus": "Strength", "manual_chat": True, "manualChat": True})
        with patch.object(ai, "get_client", return_value=SimpleNamespace(responses=SimpleNamespace(create=provider))):
            # Other endpoints retain their existing user binding. Its presence,
            # together with client flags, still cannot create the server scope.
            with ai.ai_user_scope("outer-context"), self.assertRaises(https_fn.HttpsError) as blocked:
                inspect.unwrap(main.generate_routine)(req)
            self.assertEqual(blocked.exception.details, {"reason": "QA_AI_PAUSED"})
            self.assertEqual(provider.call_count, 0)
            self.assertFalse(any(path.startswith("qa_manual_chat_usage/") for path in self.db.docs))
            self.assert_scope_closed()

    def test_actual_graph_retains_explicit_operator_lease_for_unrelated_fixture_user(self):
        now = datetime.now(timezone.utc)
        fixture_uid = "qa_approved_a"
        self.db.docs.pop("runtime_controls/qa_manual_chat")
        self.db.docs[f"user_status/{fixture_uid}"] = {"status": "approved", "synthetic": True}
        self.db.docs["runtime_controls/qa_ai"] = {
            "enabled": True, "project_id": PROJECT, "lease_id": "synthetic-operator-window",
            "issued_at": now - timedelta(minutes=1), "expires_at": now + timedelta(minutes=5),
            "allowed_uids": [fixture_uid], "allowed_tasks": ["general", "progress"],
            "remaining_calls": 2, "consumed_calls": 0,
        }
        provider = self.provider("health")
        req = SimpleNamespace(auth=SimpleNamespace(uid=fixture_uid), data={"message": "Synthetic health question"})
        with patch.object(ai, "get_client", return_value=SimpleNamespace(responses=SimpleNamespace(create=provider))):
            self.assertEqual(inspect.unwrap(main.chat)(req)["reply"], "Synthetic graph reply")
        self.assertEqual(provider.call_count, 2)
        self.assertEqual(self.db.docs["runtime_controls/qa_ai"]["remaining_calls"], 0)
        self.assertEqual(self.db.docs["runtime_controls/qa_ai"]["consumed_calls"], 2)
        self.assertFalse(any(path.startswith("qa_manual_chat_usage/") for path in self.db.docs))
        self.assert_scope_closed()


if __name__ == "__main__":
    unittest.main()
