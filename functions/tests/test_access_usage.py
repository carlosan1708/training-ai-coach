"""Offline authorization, token lifecycle, and telemetry transaction tests."""
import copy
import inspect
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import access_api
import usage_api
from lib import access
from firebase_functions import https_fn


class Snapshot:
    def __init__(self, ref, value):
        self.reference, self.id = ref, ref.path.split("/")[-1]
        self.exists, self.value = value is not None, copy.deepcopy(value)
    def to_dict(self):
        return copy.deepcopy(self.value)


class Document:
    def __init__(self, db, path):
        self.db, self.path = db, path
    def get(self, transaction=None):
        return Snapshot(self, self.db.data.get(self.path))
    def update(self, value):
        self.db.data[self.path].update(value)


class Transaction:
    def __init__(self, db): self.db = db
    def create(self, ref, data):
        if ref.path in self.db.data: raise AssertionError("Document already exists")
        self.db.data[ref.path] = copy.deepcopy(data)
    def set(self, ref, data): self.db.data[ref.path] = copy.deepcopy(data)
    def update(self, ref, data): self.db.data[ref.path].update(copy.deepcopy(data))


class Collection:
    def __init__(self, db, path): self.db, self.path = db, path
    def add(self, data):
        path = f"{self.path}/{len(self.db.data)}"
        self.db.data[path] = copy.deepcopy(data)


class Database:
    def __init__(self, data=None): self.data = copy.deepcopy(data or {})
    def document(self, path): return Document(self, path)
    def transaction(self): return Transaction(self)
    def collection(self, path): return Collection(self, path)


def request(uid="alice", email="alice@example.test", verified=True, data=None):
    return SimpleNamespace(auth=SimpleNamespace(uid=uid, token={"email": email, "email_verified": verified, "name": "Alice"}), data=data or {})


class AccessTests(unittest.TestCase):
    def setUp(self):
        self.db = Database()
        self.client = patch.object(access_api.fs, "client", return_value=self.db)
        self.transactional = patch.object(access_api.fs, "transactional", side_effect=lambda fn: fn)
        self.client.start(); self.transactional.start()
    def tearDown(self):
        self.client.stop(); self.transactional.stop()
    def invoke(self, fn, req): return inspect.unwrap(fn)(req)

    def test_authentication_and_approved_status_are_required(self):
        with self.assertRaises(https_fn.HttpsError): access.require_approved(SimpleNamespace(auth=None))
        for status in (None, "pending", "rejected"):
            self.db.data = {"user_status/alice": {"status": status}}
            with self.assertRaises(https_fn.HttpsError): access.require_approved(request())
        self.db.data["user_status/alice"]["status"] = "approved"
        self.assertEqual(access.require_approved(request()), "alice")

    def test_server_owner_role_is_the_only_bypass(self):
        with self.assertRaises(https_fn.HttpsError): access.require_owner(request())
        self.db.data["admins/alice"] = {}
        self.assertEqual(access.require_owner(request()), "alice")
        self.assertEqual(access.require_approved(request()), "alice")

    def test_request_does_not_downgrade_or_revive_existing_accounts(self):
        for status in ("approved", "rejected", "pending"):
            self.db.data["user_status/alice"] = {"status": status, "preserved": True}
            self.assertEqual(self.invoke(access_api.request_access, request(data={"status": "approved"}))["status"], status)
            self.assertEqual(self.db.data["user_status/alice"], {"status": status, "preserved": True})

    def test_request_uses_verified_claims_not_submitted_identity(self):
        self.invoke(access_api.request_access, request(data={"uid": "victim", "email": "victim@example.test", "status": "approved"}))
        self.assertEqual(self.db.data["user_status/alice"]["email"], "alice@example.test")
        self.assertEqual(self.db.data["user_status/alice"]["status"], "pending")
        self.assertNotIn("user_status/victim", self.db.data)
        with self.assertRaises(https_fn.HttpsError): self.invoke(access_api.request_access, request(uid="new", verified=False))

    def test_invitation_validity_email_and_expiry_boundaries(self):
        now = datetime(2026, 10, 17, tzinfo=timezone.utc)
        token = "a" * 32 + ".secret"
        record = {"token_hash": access_api._digest(token), "status": "pending", "email": "alice@example.test", "expires_at": now + timedelta(seconds=1)}
        access_api.validate_invitation(record, token, "alice@example.test", now)
        for changes in ({"email": "other@example.test"}, {"expires_at": now}, {"status": "revoked"}, {"token_hash": "invalid"}):
            with self.assertRaises(https_fn.HttpsError): access_api.validate_invitation({**record, **changes}, token, "alice@example.test", now)

    def test_acceptance_single_use_and_rejected_account_cannot_be_revived(self):
        now = datetime.now(timezone.utc)
        invite_id = "a" * 32
        token = f"{invite_id}.secret"
        self.db.data[f"invitations/{invite_id}"] = {"token_hash": access_api._digest(token), "status": "pending", "email": "alice@example.test", "expires_at": now + timedelta(days=1)}
        self.db.data["user_status/alice"] = {"status": "rejected"}
        with self.assertRaises(https_fn.HttpsError): self.invoke(access_api.accept_invitation, request(data={"token": token}))
        self.assertEqual(self.db.data[f"invitations/{invite_id}"]["status"], "pending")
        self.db.data["user_status/alice"] = {"status": "pending"}
        self.assertEqual(self.invoke(access_api.accept_invitation, request(data={"token": token}))["status"], "approved")
        self.assertEqual(self.db.data[f"invitations/{invite_id}"]["accepted_by"], "alice")
        self.assertEqual(self.invoke(access_api.accept_invitation, request(data={"token": token}))["status"], "approved")
        with self.assertRaises(https_fn.HttpsError): self.invoke(access_api.accept_invitation, request(uid="other-alice", data={"token": token}))

    def test_issue_hashes_token_and_qa_never_sends_external_email(self):
        self.db.data["admins/alice"] = {}
        with patch.object(access_api, "APP_BASE_URL", SimpleNamespace(value="https://qa.example.test")), patch.object(access_api, "APP_ENV", SimpleNamespace(value="qa")), patch.object(access_api.smtplib, "SMTP") as smtp:
            result = access_api._issue(request(data={"email": "FRIEND@example.test"}))
        token = result["link"].split("#token=")[1]
        stored = self.db.data[f"invitations/{result['invitation']['id']}"]
        self.assertEqual(stored["token_hash"], access_api._digest(token))
        self.assertNotIn(token, repr(self.db.data))
        self.assertEqual(result["delivery"], "captured")
        smtp.assert_not_called()

    def test_resend_rotates_token_and_revoke_prevents_acceptance(self):
        self.db.data["admins/alice"] = {}
        with patch.object(access_api, "APP_BASE_URL", SimpleNamespace(value="https://qa.example.test")), patch.object(access_api, "APP_ENV", SimpleNamespace(value="qa")):
            first = access_api._issue(request(data={"email": "alice@example.test"}))
            second = access_api._issue(request(), first["invitation"]["id"])
        self.assertNotEqual(first["link"], second["link"])
        with self.assertRaises(https_fn.HttpsError): self.invoke(access_api.accept_invitation, request(data={"token": first["link"].split("#token=")[1]}))
        self.invoke(access_api.revoke_invitation, request(data={"invitationId": first["invitation"]["id"]}))
        with self.assertRaises(https_fn.HttpsError): self.invoke(access_api.accept_invitation, request(data={"token": second["link"].split("#token=")[1]}))

    def test_delivery_uses_the_exact_copy_link_without_real_smtp(self):
        link = "https://app.example.test/invite#token=synthetic-token"
        with patch.object(access_api, "APP_ENV", SimpleNamespace(value="production")), patch.object(access_api, "SMTP_USER", SimpleNamespace(value="sender@example.test")), patch.object(access_api, "SMTP_PASSWORD", SimpleNamespace(value="synthetic-password")), patch.object(access_api.smtplib, "SMTP") as smtp:
            result = access_api._deliver(self.db, "invite-id", "alice@example.test", link)
            message = smtp.return_value.__enter__.return_value.send_message.call_args.args[0]
        self.assertEqual(result, "sent")
        self.assertIn(link, message.get_content())
        self.assertEqual(message["To"], "alice@example.test")

    def test_resend_cannot_resurrect_an_invitation_accepted_concurrently(self):
        invite_id = "a" * 32
        record = {"email": "alice@example.test", "status": "pending", "created_at": datetime.now(timezone.utc), "created_by": "alice"}
        self.db.data["admins/alice"] = {}
        self.db.data[f"invitations/{invite_id}"] = record
        original_get = Document.get
        reads = 0
        def racing_get(ref, transaction=None):
            nonlocal reads
            if ref.path == f"invitations/{invite_id}":
                reads += 1
                return Snapshot(ref, {**record, "status": "accepted" if reads > 1 else "pending"})
            return original_get(ref, transaction)
        with patch.object(Document, "get", racing_get), patch.object(access_api, "APP_BASE_URL", SimpleNamespace(value="https://qa.example.test")):
            with self.assertRaises(https_fn.HttpsError): access_api._issue(request(), invite_id)
        self.assertEqual(self.db.data[f"invitations/{invite_id}"], record)


class UsageTests(unittest.TestCase):
    def setUp(self):
        self.db = Database({"user_status/alice": {"status": "approved"}})
        self.patches = [patch.object(usage_api.fs, "client", return_value=self.db), patch.object(usage_api.fs, "transactional", side_effect=lambda fn: fn), patch.object(usage_api, "APP_ENV", SimpleNamespace(value="production"))]
        for item in self.patches: item.start()
    def tearDown(self):
        for item in reversed(self.patches): item.stop()

    def test_reporting_day_uses_costa_rica_midnight(self):
        self.assertEqual(usage_api.reporting_day(datetime(2026, 10, 17, 5, 59, tzinfo=timezone.utc)), "2026-10-16")
        self.assertEqual(usage_api.reporting_day(datetime(2026, 10, 17, 6, 0, tzinfo=timezone.utc)), "2026-10-17")

    def test_ui_actions_are_bounded_private_and_idempotent(self):
        now = datetime(2026, 10, 17, 12, tzinfo=timezone.utc)
        batch = {"weight_edited": 3, "set_completion_toggled": 8}
        self.assertTrue(usage_api.record_usage_event("alice", "ui_actions", "batch-once", screen="workout", actions=batch, at=now))
        self.assertFalse(usage_api.record_usage_event("alice", "ui_actions", "batch-once", screen="workout", actions=batch, at=now))
        self.assertTrue(usage_api.record_usage_event("alice", "screen_view", "next-view", screen="training", at=now))
        self.assertEqual(self.db.data["usage_user_days/actions:2026-10-17:alice"]["actions"], batch)
        # A still-deployed older writer replaces this complete base document.
        self.db.data["usage_user_days/2026-10-17_alice"] = {"uid": "alice", "date": "2026-10-17", "sessions": 1}
        self.assertTrue(usage_api.record_usage_event("alice", "ui_actions", "batch-two", screen="workout", actions={"weight_edited": 1}, at=now))
        self.assertEqual(self.db.data["usage_user_days/actions:2026-10-17:alice"]["actions"], {"weight_edited": 4, "set_completion_toggled": 8})
        self.assertNotIn("actions", self.db.data["usage_user_days/2026-10-17_alice"])
        for invalid in ({}, {"weight_kg": 75}, {"exercise": "Bench press"}, {"weight_edited": True}, {"weight_edited": 101}, {"weight_edited": -1}, {"weight_edited": 1.5}):
            self.assertFalse(usage_api.record_usage_event("alice", "ui_actions", "bad-batch", screen="workout", actions=invalid, at=now))
        self.assertFalse(usage_api.record_usage_event("alice", "ui_actions", "bad-screen", screen="coach", actions=batch, at=now))
        self.assertFalse(usage_api.record_usage_event("alice", "heartbeat", "bad-ping", screen="workout", actions=batch, at=now))

    def test_action_batches_preserve_account_exclusions(self):
        self.db.data["admins/alice"] = {}
        self.assertFalse(usage_api.record_usage_event("alice", "ui_actions", "owner-batch", screen="workout", actions={"finish_clicked": 1}))

    def test_action_documents_do_not_inflate_visits_active_days_or_retention(self):
        now = datetime(2026, 10, 17, 12, tzinfo=timezone.utc)
        self.db.data.update({
            "usage_users/alice": {"first_seen": now, "last_active": now},
            "usage_user_days/2026-10-17_alice": {"uid": "alice", "date": "2026-10-17", "sessions": 1, "events": {"workout_completed": 1}},
            "usage_user_days/actions:2026-10-17:alice": {"kind": "ui_actions", "uid": "alice", "date": "2026-10-17", "actions": {"weight_edited": 3}},
            "admins/owner": {},
            "usage_user_days/actions:2026-10-17:owner": {"kind": "ui_actions", "uid": "owner", "date": "2026-10-17", "actions": {"weight_edited": 90}},
        })
        db = self.db
        class ReportCollection:
            def __init__(self, path): self.path = path
            def where(self, **_kwargs): return self
            def stream(self):
                return [Snapshot(Document(db, path), value) for path, value in db.data.items()
                        if path.startswith(self.path + "/") and path.count("/") == 1]
        with patch.object(db, "collection", side_effect=ReportCollection), patch.object(usage_api, "require_owner", return_value="owner"), patch.object(usage_api, "_utcnow", return_value=now):
            report = inspect.unwrap(usage_api.usage_report)(request(data={"days": 7}))
        self.assertEqual(report["actions"], {"weight_edited": 3})
        self.assertEqual(report["sessions"], 1)
        self.assertEqual(report["workouts"], 1)
        self.assertEqual(report["active"]["7"], 1)
        self.assertEqual(report["people"][0]["activeDays"], 1)

    def test_event_retries_do_not_double_count(self):
        now = datetime(2026, 10, 17, 12, tzinfo=timezone.utc)
        self.assertTrue(usage_api.record_usage_event("alice", "workout_completed", "workout:once", at=now))
        self.assertFalse(usage_api.record_usage_event("alice", "workout_completed", "workout:once", at=now))
        self.assertEqual(self.db.data["usage_user_days/2026-10-17_alice"]["events"]["workout_completed"], 1)
        self.assertEqual(self.db.data["usage_users/alice"]["session_count"], 1)

    def test_session_timeout_and_out_of_order_events(self):
        now = datetime(2026, 10, 17, 12, tzinfo=timezone.utc)
        first, count = usage_api.activity_transition({}, "screen_view", now)
        self.assertEqual(count, 1)
        second, count = usage_api.activity_transition(first, "heartbeat", now + timedelta(minutes=29, seconds=59))
        self.assertEqual(count, 0)
        third, count = usage_api.activity_transition(first, "screen_view", now + timedelta(minutes=30))
        self.assertEqual(count, 1)
        late, count = usage_api.activity_transition(third, "workout_completed", now - timedelta(minutes=1))
        self.assertEqual(count, 0)
        self.assertEqual(late["last_active"], third["last_active"])
        self.assertEqual(late["first_seen"], now - timedelta(minutes=1))
        self.assertEqual(second["session_count"], 1)

    def test_heartbeat_throttle_and_privacy_allowlist(self):
        now = datetime(2026, 10, 17, 12, tzinfo=timezone.utc)
        self.assertTrue(usage_api.record_usage_event("alice", "heartbeat", "ping-one", at=now, screen="training"))
        self.assertFalse(usage_api.record_usage_event("alice", "heartbeat", "ping-two", at=now + timedelta(seconds=29), screen="training"))
        self.assertFalse(usage_api.record_usage_event("alice", "arbitrary-health-data", "bad-event", at=now))
        self.assertFalse(usage_api.record_usage_event("alice", "screen_view", "bad-url", screen="/chat?secret=hello", at=now))
        events = [value for key, value in self.db.data.items() if key.startswith("usage_events/")]
        self.assertEqual(set(events[0]), {"uid", "event", "source", "screen", "created_at", "expires_at"})

    def test_production_excludes_owner_pending_rejected_and_test_accounts(self):
        now = datetime.now(timezone.utc)
        for fields in ({"status": "pending"}, {"status": "rejected"}, {"status": "approved", "is_test": True}):
            self.db.data["user_status/alice"] = fields
            self.assertFalse(usage_api.record_usage_event("alice", "screen_view", "event", at=now))
        self.db.data["user_status/alice"] = {"status": "approved"}
        self.db.data["admins/alice"] = {}
        self.assertFalse(usage_api.record_usage_event("alice", "screen_view", "event", at=now))

    def test_qa_includes_synthetic_approved_users(self):
        self.db.data["user_status/alice"]["is_test"] = True
        with patch.object(usage_api, "APP_ENV", SimpleNamespace(value="qa")):
            self.assertTrue(usage_api.record_usage_event("alice", "screen_view", "qa-event"))

    def test_retention_waits_for_completed_day_and_requires_exact_return_day(self):
        users = [{"uid": "alice", "first_seen": datetime(2026, 10, 1, 12, tzinfo=timezone.utc)}, {"uid": "new", "first_seen": datetime(2026, 10, 10, 12, tzinfo=timezone.utc)}]
        days = [{"uid": "alice", "date": "2026-10-08"}, {"uid": "new", "date": "2026-10-17"}]
        report = usage_api.retention_d7(users, days, "2026-10-17")
        self.assertEqual(report, {"eligible": 1, "returned": 1, "rate": 100.0})
        self.assertEqual(usage_api.retention_d7(users, [{"uid": "alice", "date": "2026-10-09"}], "2026-10-17")["rate"], 0)


if __name__ == "__main__": unittest.main()
