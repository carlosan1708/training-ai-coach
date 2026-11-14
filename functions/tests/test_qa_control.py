"""Offline checks for privileged, manually budgeted QA AI activation."""
import contextlib
from datetime import datetime, timedelta, timezone
import io
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import qa_control


class QaControlTests(unittest.TestCase):
    project = "training-coach-qa-20261017"

    def test_scope_refusals_happen_before_cloud_access(self):
        commands = [
            ["disable", "--project", "ai-training-coach-6880b", "--confirm-project", "ai-training-coach-6880b"],
            ["disable", "--project", self.project, "--confirm-project", "other-qa-project"],
            ["enable", "--project", self.project, "--confirm-project", self.project],
            ["enable", "--project", self.project, "--confirm-project", self.project,
             "--run-requested", self.project, "--uid", "real-user", "--task", "general"],
            ["enable", "--project", self.project, "--confirm-project", self.project,
             "--run-requested", self.project, "--uid", "qa_approved_a", "--task", "general", "--requests", "21"],
        ]
        for command in commands:
            with self.subTest(command=command), patch.object(qa_control, "initialize_admin") as initialize, \
                    contextlib.redirect_stderr(io.StringIO()), patch.dict(os.environ, {}, clear=True):
                self.assertEqual(qa_control.main(command), 2)
                initialize.assert_not_called()

    def test_lease_expiry_and_budget_are_enforced_by_status(self):
        now = datetime(2026, 10, 17, tzinfo=timezone.utc)
        lease = qa_control.lease_document(self.project, ["qa_approved_a"], ["extraction", "progress"], 10, 4, now)
        self.assertTrue(qa_control.status_document(lease, self.project, now)["active"])
        for changed in ({"remaining_calls": 0}, {"remaining_calls": True}, {"remaining_calls": 21},
                        {"enabled": False}, {"project_id": "another-qa-project"},
                        {"expires_at": now + timedelta(minutes=31)}, {"issued_at": now + timedelta(minutes=1)},
                        {"allowed_uids": ["qa_pending"]}, {"allowed_tasks": ["unsupported"]}):
            with self.subTest(changed=changed):
                self.assertFalse(qa_control.status_document({**lease, **changed}, self.project, now)["active"])
        self.assertFalse(qa_control.status_document(lease, self.project, now + timedelta(minutes=10))["active"])
        self.assertNotIn("secret", qa_control.status_document({**lease, "secret": "never print"}, self.project, now))

    def test_enable_writes_only_after_accounts_are_verified_and_disable_revokes(self):
        from firebase_admin import firestore
        stored = {}
        class Reference:
            def set(self, value):
                stored.clear()
                stored.update(value)
            def get(self):
                return SimpleNamespace(exists=bool(stored), to_dict=lambda: stored.copy())
        reference = Reference()
        db = SimpleNamespace(document=lambda path: reference if path == qa_control.CONTROL_PATH else None)
        base = ["--project", self.project, "--confirm-project", self.project]
        with patch.object(qa_control, "initialize_admin", return_value=object()), \
                patch.object(firestore, "client", return_value=db), \
                patch.object(qa_control, "verify_fixture_accounts", side_effect=RuntimeError("fixture changed")), \
                contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(qa_control.main(["enable", *base, "--run-requested", self.project,
                                            "--uid", "qa_approved_a", "--task", "progress"]), 1)
            self.assertEqual(stored, {})
        with patch.object(qa_control, "initialize_admin", return_value=object()), \
                patch.object(firestore, "client", return_value=db), \
                patch.object(qa_control, "verify_fixture_accounts") as verify, \
                contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(qa_control.main(["enable", *base, "--run-requested", self.project,
                                            "--uid", "qa_approved_a", "--task", "progress"]), 0)
            verify.assert_called_once()
            self.assertTrue(qa_control.status_document(stored, self.project)["active"])
            self.assertEqual(qa_control.main(["disable", *base]), 0)
            self.assertFalse(qa_control.status_document(stored, self.project)["active"])
            self.assertFalse(stored["enabled"])

    def test_sdk_failure_does_not_print_credential_payload(self):
        errors = io.StringIO()
        with patch.object(qa_control, "initialize_admin", side_effect=RuntimeError("PRIVATE_TOKEN")), \
                contextlib.redirect_stderr(errors):
            self.assertEqual(qa_control.main(["status", "--project", self.project, "--confirm-project", self.project]), 1)
        self.assertNotIn("PRIVATE_TOKEN", errors.getvalue())


if __name__ == "__main__":
    unittest.main()
