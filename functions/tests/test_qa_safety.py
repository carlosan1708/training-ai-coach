"""Offline safety checks for privileged QA tooling; no Firebase/Google calls."""
import contextlib
import copy
import io
import sys
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import seed_qa
import bootstrap_owner


class Snapshot:
    def __init__(self, value):
        self.exists, self.value = value is not None, copy.deepcopy(value)
    def to_dict(self):
        return copy.deepcopy(self.value)


class Reference:
    def __init__(self, db, path):
        self.db, self.path = db, path
    def get(self):
        return Snapshot(self.db.data.get(self.path))
    def set(self, value, merge=False):
        self.db.mutations.append(("set", self.path))
        self.db.data[self.path] = {**(self.db.data.get(self.path, {}) if merge else {}), **value}
    def create(self, value):
        if self.path in self.db.data:
            raise AssertionError("Duplicate create")
        self.set(value)
    def delete(self):
        self.db.mutations.append(("delete", self.path))
        self.db.data.pop(self.path, None)


class Database:
    def __init__(self, data=None):
        self.data, self.mutations = copy.deepcopy(data or {}), []
    def document(self, path):
        return Reference(self, path)
    def batch(self):
        return self
    def set(self, ref, value, merge=False):
        ref.set(value, merge)
    def commit(self):
        return []


class QaSafetyTests(unittest.TestCase):
    project = "training-coach-qa-20261017"

    def test_seed_rejects_production_wrong_confirmation_and_non_qa_before_cloud_access(self):
        for project, confirmation in [
            (seed_qa.PRODUCTION_PROJECT, seed_qa.PRODUCTION_PROJECT),
            (self.project, "other-qa-project"), ("training-coach-staging", "training-coach-staging"),
            ("training-qa-production", "training-qa-production"),
        ]:
            with self.subTest(project=project), patch.object(seed_qa, "initialize_admin") as initialize, \
                    patch.object(seed_qa, "gcloud") as gcloud, contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(seed_qa.main(["--project", project, "--confirm-project", confirmation]), 2)
                initialize.assert_not_called()
                gcloud.assert_not_called()

    def test_demo_requires_both_explicit_loopback_emulators(self):
        valid = {"FIREBASE_AUTH_EMULATOR_HOST": "127.0.0.1:9099", "FIRESTORE_EMULATOR_HOST": "localhost:8080"}
        self.assertEqual(seed_qa.guard_qa_project(seed_qa.EMULATOR_PROJECT, seed_qa.EMULATOR_PROJECT, valid), "emulator")
        for env in [{}, {**valid, "FIRESTORE_EMULATOR_HOST": "remote.example:8080"}, {**valid, "FIREBASE_AUTH_EMULATOR_HOST": "https://localhost:9099"}]:
            with self.assertRaises(seed_qa.SafetyError):
                seed_qa.guard_qa_project(seed_qa.EMULATOR_PROJECT, seed_qa.EMULATOR_PROJECT, env)
        with self.assertRaises(seed_qa.SafetyError):
            seed_qa.guard_qa_project(self.project, self.project, valid)

    def test_admin_user_credentials_bind_quota_to_confirmed_project_without_changing_cli_defaults(self):
        import firebase_admin
        from firebase_admin import credentials
        from google.oauth2.credentials import Credentials
        original = Credentials(token="synthetic-short-lived-token", quota_project_id=seed_qa.PRODUCTION_PROJECT)
        with patch.object(credentials, "ApplicationDefault") as adc, patch.object(firebase_admin, "initialize_app") as initialize:
            adc.return_value.get_credential.return_value = original
            seed_qa.initialize_admin(self.project)
            wrapper, options = initialize.call_args.args
            self.assertEqual(wrapper.get_credential().quota_project_id, self.project)
            self.assertEqual(options["projectId"], self.project)
            self.assertEqual(original.quota_project_id, seed_qa.PRODUCTION_PROJECT)

    def test_seed_plan_contains_only_inert_synthetic_documents_and_no_model_trigger_paths(self):
        documents = seed_qa.fixture_documents("safety-test")
        self.assertTrue(documents)
        for path, value in documents.items():
            self.assertTrue(seed_qa.allowed_fixture_path(path), path)
            self.assertNotIn(path.split("/")[2:3], [["logs"], ["workout_sessions"], ["measurement_jobs"], ["body_composition_reports"]])
            self.assertTrue(value["synthetic"])
            self.assertEqual(value["qa_run_id"], "safety-test")
        approved = [account for account in seed_qa.ACCOUNTS.values() if account[3] == "approved"]
        self.assertTrue(all(f"users/{account[0]}/weekly_reports/qa_seed_snapshot" in documents for account in approved))

    def test_existing_passwords_are_preserved_and_reserved_uid_collision_aborts_before_writes(self):
        from firebase_admin import auth
        users = {role: {"uid": values[0], "email": values[1], "password": "existing-password-keep-this-secret"}
                 for role, values in seed_qa.ACCOUNTS.items()}
        payload = {"schemaVersion": 1, "projectId": self.project, "users": users}
        by_uid = {value[0]: SimpleNamespace(email=value[1]) for value in seed_qa.ACCOUNTS.values()}
        db = Database()
        with patch.object(auth, "get_user", side_effect=lambda uid, **_: by_uid[uid]), \
                patch.object(auth, "update_user") as update, patch.object(auth, "create_user") as create, \
                patch.object(seed_qa, "read_secret", return_value=payload), \
                patch.object(seed_qa, "write_secret") as write_secret, \
                patch.object(seed_qa.secrets, "token_urlsafe") as generate:
            seed_qa.seed(db, object(), self.project, "repeat-run")
            generate.assert_not_called()
            write_secret.assert_not_called()
            create.assert_not_called()
            self.assertEqual(update.call_count, 6)
            self.assertTrue(all(call.kwargs["password"] == users[role]["password"]
                                for role, call in zip(seed_qa.ACCOUNTS, update.call_args_list)))
        db = Database()
        with patch.object(auth, "get_user", return_value=SimpleNamespace(email="real-person@example.com")), \
                patch.object(auth, "update_user") as update, patch.object(seed_qa, "write_secret") as write_secret:
            with self.assertRaises(seed_qa.SafetyError):
                seed_qa.seed(db, object(), self.project, "collision")
            self.assertEqual(db.mutations, [])
            update.assert_not_called()
            write_secret.assert_not_called()

    def test_cleanup_rejects_forged_scopes_and_retains_other_runs(self):
        from firebase_admin import auth
        marker = {"synthetic": True, "qa_run_id": "run-a", "documents": ["users/real-person/profile/data"], "created_auth_uids": []}
        db = Database({"qa_runs/run-a": marker})
        with self.assertRaises(seed_qa.SafetyError):
            seed_qa.cleanup_run(db, object(), "run-a")
        self.assertEqual(db.mutations, [])
        owned = "users/qa_approved_a/routines/qa_baseline"
        other = "users/qa_approved_b/routines/qa_baseline"
        marker["documents"] = [owned, other]
        marker["created_auth_uids"] = ["qa_approved_b"]
        db = Database({"qa_runs/run-a": marker,
                       owned: {"synthetic": True, "qa_run_id": "run-a"},
                       other: {"synthetic": True, "qa_run_id": "run-b"},
                       "user_status/qa_approved_b": {"synthetic": True, "qa_run_id": "run-b"}})
        email = seed_qa.ACCOUNTS["approvedB"][1]
        with patch.object(auth, "get_user", return_value=SimpleNamespace(email=email)), patch.object(auth, "delete_user") as delete_user:
            self.assertEqual(seed_qa.cleanup_run(db, object(), "run-a"), 1)
            delete_user.assert_not_called()
        self.assertIn(other, db.data)
        self.assertNotIn(owned, db.data)

    def test_explicit_local_credentials_bypass_secret_manager_and_exist_before_auth_mutation(self):
        from firebase_admin import auth
        temporary_root = seed_qa.ROOT / ".qa"
        temporary_root.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="qa-safety-", dir=temporary_root) as directory, patch.object(seed_qa, "ROOT", Path(directory)):
            self.assertTrue(Path(directory).resolve().is_relative_to(temporary_root.resolve()))
            filename = Path(directory) / ".qa" / "users.local.json"
            db = Database()
            def fail_create(**_):
                self.assertTrue(filename.exists(), "Credentials must survive a first Auth-write failure.")
                raise RuntimeError("Synthetic Auth failure")
            with patch.object(auth, "get_user", side_effect=auth.UserNotFoundError("synthetic")), \
                    patch.object(auth, "create_user", side_effect=fail_create), \
                    patch.object(seed_qa, "read_secret") as read_secret, patch.object(seed_qa, "write_secret") as write_secret:
                with self.assertRaises(RuntimeError):
                    seed_qa.seed(db, object(), self.project, "local-retry", credentials_file=filename)
                read_secret.assert_not_called()
                write_secret.assert_not_called()
            first = json.loads(filename.read_text(encoding="utf-8"))
            with patch.object(auth, "get_user", side_effect=auth.UserNotFoundError("synthetic")), \
                    patch.object(auth, "create_user") as create, patch.object(seed_qa.secrets, "token_urlsafe") as generate, \
                    patch.object(seed_qa, "read_secret") as read_secret, patch.object(seed_qa, "write_secret") as write_secret:
                seed_qa.seed(db, object(), self.project, "local-retry", credentials_file=filename)
                self.assertEqual(create.call_count, 6)
                generate.assert_not_called()
                read_secret.assert_not_called()
                write_secret.assert_not_called()
            self.assertEqual(json.loads(filename.read_text(encoding="utf-8")), first)

    def test_cli_failures_never_print_sdk_exception_payload_or_token(self):
        output, errors = io.StringIO(), io.StringIO()
        with patch.object(seed_qa, "initialize_admin", side_effect=RuntimeError("TOKEN_AND_PASSWORD_MUST_NOT_APPEAR")), \
                contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors), patch.dict(seed_qa.os.environ, {}, clear=True):
            self.assertEqual(seed_qa.main(["--project", self.project, "--confirm-project", self.project]), 1)
        self.assertNotIn("TOKEN_AND_PASSWORD", output.getvalue() + errors.getvalue())

    def test_publish_secret_only_preserves_local_passwords_and_never_initializes_auth_or_firestore(self):
        temporary_root = seed_qa.ROOT / ".qa"
        temporary_root.mkdir(exist_ok=True)
        payload = {"schemaVersion": 1, "projectId": self.project, "runId": "existing-run", "users": {
            role: {"uid": values[0], "email": values[1], "password": "existing-synthetic-password-unchanged"}
            for role, values in seed_qa.ACCOUNTS.items()}}
        with tempfile.TemporaryDirectory(prefix="qa-safety-", dir=temporary_root) as directory, patch.object(seed_qa, "ROOT", Path(directory)):
            self.assertTrue(Path(directory).resolve().is_relative_to(temporary_root.resolve()))
            filename = Path(directory) / ".qa" / "users.local.json"
            seed_qa.write_private_file(filename, payload)
            original = filename.read_bytes()
            with patch.object(seed_qa, "initialize_admin") as initialize, patch.object(seed_qa, "write_secret") as publish, \
                    patch.dict(seed_qa.os.environ, {}, clear=True), contextlib.redirect_stdout(io.StringIO()):
                result = seed_qa.main(["--project", self.project, "--confirm-project", self.project,
                                       "--credentials-file", str(filename), "--publish-secret"])
                self.assertEqual(result, 0)
                initialize.assert_not_called()
                publish.assert_called_once_with(self.project, payload)
            self.assertEqual(filename.read_bytes(), original)

    def test_private_credential_copy_cannot_escape_ignored_qa_directory(self):
        with self.assertRaises(seed_qa.SafetyError):
            seed_qa.private_file_path(seed_qa.ROOT / "web" / "public" / "credentials.json")
        with self.assertRaises(seed_qa.SafetyError):
            seed_qa.private_file_path(seed_qa.ROOT / ".qa" / ".." / "credentials.json")

    def test_bootstrap_requires_existing_uid_and_preserves_all_other_user_data(self):
        with self.assertRaises(seed_qa.SafetyError):
            bootstrap_owner.validate_target(self.project, self.project, "", {})
        with self.assertRaises(seed_qa.SafetyError):
            bootstrap_owner.validate_target(self.project, self.project, "admins/other", {})
        db = Database({"users/existing-uid/profile/data": {"name": "Existing person"}, "user_status/existing-uid": {"status": "approved"}})
        initial = copy.deepcopy(db.data)
        auth = SimpleNamespace(get_user=lambda uid, **_: SimpleNamespace(disabled=False))
        self.assertTrue(bootstrap_owner.bootstrap(db, auth, object(), "existing-uid"))
        self.assertFalse(bootstrap_owner.bootstrap(db, auth, object(), "existing-uid"))
        self.assertEqual({key: value for key, value in db.data.items() if not key.startswith("admins/")}, initial)


if __name__ == "__main__":
    unittest.main()
