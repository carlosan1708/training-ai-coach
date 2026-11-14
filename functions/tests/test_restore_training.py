"""Offline scope, fidelity and concurrency checks for the one-person QA restore."""
import base64
import contextlib
import copy
from datetime import datetime, timedelta, timezone
import io
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import restore_training as restore
import seed_qa

NOW = datetime(2026, 10, 16, 18, tzinfo=timezone.utc)
QA = "training-coach-qa-20261017"


def native_clone(value):
    # Timestamps are immutable; Python deepcopy drops their nanosecond slot.
    if isinstance(value, dict): return {key: native_clone(item) for key, item in value.items()}
    if isinstance(value, list): return [native_clone(item) for item in value]
    return value


class Snapshot:
    def __init__(self, reference):
        self.reference, self.id = reference, reference.path.rsplit("/", 1)[1]
        self.exists = reference.path in reference.db.docs
        self.value = native_clone(reference.db.docs.get(reference.path))
        self.update_time = reference.db.versions.get(reference.path)
        self.create_time = NOW if self.exists else None
    def to_dict(self):
        return native_clone(self.value)


class Reference:
    def __init__(self, db, path):
        self.db, self.path = db, path
        self.id, self._client = path.rsplit("/", 1)[-1], db
        self._document_path = f"projects/{db.project}/databases/(default)/documents/{path}"
    def get(self, transaction=None):
        if transaction and transaction.pending:
            raise AssertionError("Firestore reads must precede writes")
        return Snapshot(self)


class Query:
    def __init__(self, db, path, maximum=None, field=None, value=None, order=None):
        self.db, self.path, self.maximum = db, path, maximum
        self.field, self.value, self.order = field, value, order
    def limit(self, value):
        return Query(self.db, self.path, value, self.field, self.value, self.order)
    def where(self, *, filter):
        return Query(self.db, self.path, self.maximum, filter.field_path, filter.value, self.order)
    def order_by(self, key, direction=None):
        return Query(self.db, self.path, self.maximum, self.field, self.value, (key, direction))
    def stream(self):
        paths = [path for path in self.db.docs if path.startswith(self.path + "/") and path.count("/") == self.path.count("/") + 1]
        if self.field:
            paths = [path for path in paths if self.db.docs[path].get(self.field) == self.value]
        if self.order:
            paths.sort(key=lambda path: self.db.docs[path].get(self.order[0], ""), reverse=self.order[1] == "DESCENDING")
            self.db.history_queries += 1
        return iter(Snapshot(self.db.document(path)) for path in paths[:self.maximum])


class Transaction:
    def __init__(self, db):
        self.db, self.pending, self.id = db, [], b"synthetic-transaction"
    def _add_write_pbs(self, writes):
        from google.cloud.firestore_v1 import _helpers
        for write in writes:
            if write.current_document.exists is not False:
                raise AssertionError("Every write must have exists=false")
            prefix = self.db._database_string + "/documents/"
            if not write.update.name.startswith(prefix): raise AssertionError("Wrong target project")
            self.pending.append((write.update.name[len(prefix):], _helpers.decode_dict(write.update.fields, self.db)))
    def commit(self):
        if any(path in self.db.docs for path, _ in self.pending):
            raise AssertionError("A create-only precondition was violated")
        for path, value in self.pending:
            self.db.docs[path], self.db.versions[path] = value, NOW
            self.db.writes.append(path)


class Database:
    def __init__(self, project, docs):
        self.project, self.docs = project, native_clone(docs)
        self._database_string = f"projects/{project}/databases/(default)"
        self._firestore_api = SimpleNamespace(batch_get_documents=self.raw_get)
        self.versions = {path: NOW for path in docs}
        self.writes, self.history_queries = [], 0
    def document(self, path): return Reference(self, path)
    def collection(self, path): return Query(self, path)
    def transaction(self): return Transaction(self)
    def raw_get(self, *, request):
        from google.cloud.firestore_v1 import _helpers
        from google.cloud.firestore_v1.types import Document
        prefix = self._database_string + "/documents/"
        for name in request["documents"]:
            path = name[len(prefix):]
            if path in self.docs:
                document = Document(name=name, fields=_helpers.encode_dict(self.docs[path]), create_time=NOW, update_time=self.versions.get(path, NOW))
                yield SimpleNamespace(found=document, missing="")
            else:
                yield SimpleNamespace(found=Document(), missing=name)


def transactional(function):
    def run(transaction):
        result = function(transaction)
        transaction.commit()
        return result
    return run


def user(google_id="same-google-person", email="same@example.test", **changes):
    return SimpleNamespace(disabled=False, email_verified=True, email=email,
                           provider_data=[SimpleNamespace(provider_id="google.com", uid=google_id)], **changes)


class RestoreTrainingTests(unittest.TestCase):
    def setUp(self):
        from google.api_core.datetime_helpers import DatetimeWithNanoseconds
        self.stamp = DatetimeWithNanoseconds(2026, 10, 16, 18, nanosecond=123456789, tzinfo=timezone.utc)
        exercise = {"id": "exercise", "name": "Private original exercise", "sets": 2, "reps": 10,
                    "images": ["Library/0.jpg", "Library/1.jpg"], "library_id": "Library", "weight_kg": 12.5}
        self.source = Database(restore.PRODUCTION_PROJECT, {
            "users/s/routines/original": {"name": "Private original routine", "days": [{"id": "day", "name": "Day", "exercises": [exercise]}], "created_at": self.stamp, "session_count": 1, "opaque_bytes": b"\x00\xff"},
            "users/s/workout_sessions/history": {"routine_id": "original", "routine_name": "Private original routine", "day_id": "day", "date": "2026-10-16", "status": "completed", "started_at": self.stamp, "completed_at": self.stamp + timedelta(minutes=20), "exercises": [{"name": exercise["name"], "routine_exercise_id": "exercise", "sets": [{"reps": 10, "weight_kg": 12.5, "done": True}]}]},
        })
        self.target = Database(QA, {"user_status/t": {"status": "approved"}, "runtime_controls/qa_ai": {"enabled": False}})
        private_test_root = seed_qa.ROOT / ".qa"
        private_test_root.mkdir(exist_ok=True)
        self.folder = tempfile.TemporaryDirectory(prefix="restore-test-", dir=private_test_root)
        if not Path(self.folder.name).resolve().is_relative_to(private_test_root.resolve()):
            raise AssertionError("Temporary cleanup escaped the private test folder")
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)
        self.backup = self.root / ".qa" / "restore.json"
        self.root_patch = patch.object(seed_qa, "ROOT", self.root)
        self.root_patch.start(); self.addCleanup(self.root_patch.stop)
        self.transaction_patch = patch("firebase_admin.firestore.transactional", transactional)
        self.transaction_patch.start(); self.addCleanup(self.transaction_patch.stop)

    def test_scope_and_google_identity_fail_before_any_cloud_access(self):
        invalid = [["--target-project", restore.PRODUCTION_PROJECT, "--confirm-target-project", restore.PRODUCTION_PROJECT],
                   ["--target-project", QA, "--confirm-target-project", "wrong-qa-project"]]
        for args in invalid:
            with patch.object(restore, "initialize_admin") as initialize, contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(restore.main([*args, "--source-uid", "s", "--target-uid", "t"]), 2)
                initialize.assert_not_called()
        restore.verify_identity(user(), user())
        for other in (user(google_id="someone-else"), user(email="other@example.test"),
                      SimpleNamespace(disabled=True, email_verified=True, email="same@example.test", provider_data=[])):
            with self.assertRaises(restore.SafetyError):
                restore.verify_identity(user(), other)

    def test_default_cli_is_read_only_and_prints_counts_without_training_facts(self):
        output = io.StringIO()
        with patch.object(restore, "initialize_admin", side_effect=["source-app", "target-app"]), \
                patch("firebase_admin.firestore.client", side_effect=[self.source, self.target]), \
                patch("firebase_admin.auth.get_user", side_effect=[user(), user()]), contextlib.redirect_stdout(output):
            result = restore.main(["--target-project", QA, "--confirm-target-project", QA, "--source-uid", "s", "--target-uid", "t", "--expected-routines", "1", "--expected-sessions", "1"])
        self.assertEqual(result, 0)
        self.assertEqual(json.loads(output.getvalue())["action"], "dry_run")
        self.assertNotIn("Private original", output.getvalue())
        self.assertEqual((self.source.writes, self.target.writes), ([], []))
        self.assertFalse(self.backup.exists())

    def test_apply_preserves_typed_values_ids_media_and_links_and_repeat_is_noop(self):
        original = restore.inventory(self.source, "s")
        restore.check_expected_counts(original, 1, 1)
        created, path = restore.apply_restore(self.source, self.target, "s", "t", original, self.backup)
        self.assertEqual(created, 2)
        self.assertTrue(path.exists())
        self.assertEqual(self.source.writes, [])
        self.assertTrue(self.target.history_queries)
        for record in original.records:
            self.assertTrue(restore.typed_equal(record.value, self.target.docs[record.path("t")]))
        self.assertEqual(self.target.docs["users/t/routines/original"]["created_at"].nanosecond, 123456789)
        from google.cloud.firestore_v1.types import Document
        backup = json.loads(path.read_text())
        routine = next(value for value in backup["source"] if "/routines/" in value["path"])
        proto = Document.deserialize(base64.b64decode(routine["firestore_document_proto_base64"]))
        self.assertEqual(Document.pb(proto).fields["created_at"].timestamp_value.nanos, 123456789)
        self.assertEqual(proto.fields["opaque_bytes"].bytes_value, b"\x00\xff")
        created_again, _ = restore.apply_restore(self.source, self.target, "s", "t", original, self.backup.with_name("second.json"))
        self.assertEqual(created_again, 0)
        self.assertEqual(len(self.target.writes), 2)

    def test_real_sdk_raw_write_preserves_original_wire_fields_without_snapshot_deepcopy(self):
        from google.auth.credentials import AnonymousCredentials
        from google.cloud.firestore_v1 import Client, _helpers
        from google.cloud.firestore_v1.types import Document
        source = Client(project=restore.PRODUCTION_PROJECT, credentials=AnonymousCredentials())
        target = Client(project=QA, credentials=AnonymousCredentials())
        self.addCleanup(source.close); self.addCleanup(target.close)
        source_ref, target_ref = source.document("users/s/routines/r"), target.document("users/t/routines/r")
        raw = Document(name=source_ref._document_path, fields=_helpers.encode_dict({"at": self.stamp, "large_integer": 2**60, "bytes": b"\x00\xff"}), create_time=NOW, update_time=NOW)
        snapshot = restore.NativeSnapshot(source_ref, raw)
        batch = target.batch()
        restore.queue_create(batch, target_ref, snapshot)
        write = batch._write_pbs[0]
        self.assertFalse(write.current_document.exists)
        self.assertEqual(Document.pb(write.update).fields["at"].timestamp_value.nanos, 123456789)
        self.assertEqual(Document.pb(write.update).fields["large_integer"].integer_value, 2**60)
        expected = Document.pb(Document(fields=raw.fields)).SerializeToString(deterministic=True)
        actual = Document.pb(Document(fields=write.update.fields)).SerializeToString(deterministic=True)
        self.assertEqual(actual, expected)

    def test_differing_target_collision_and_open_ai_window_refuse_all_writes(self):
        original = restore.inventory(self.source, "s")
        for change in ("collision", "ai_open"):
            target = copy.deepcopy(self.target)
            if change == "collision": target.docs["users/t/routines/original"] = {"name": "Different existing data"}
            else: target.docs["runtime_controls/qa_ai"] = {"enabled": True}
            with self.subTest(change=change), self.assertRaises(restore.SafetyError):
                restore.apply_restore(self.source, target, "s", "t", original, self.backup)
            self.assertEqual(target.writes, [])
            self.assertFalse(self.backup.exists())

    def test_source_version_drift_after_backup_aborts_before_target_writes(self):
        original = restore.inventory(self.source, "s")
        write = restore.write_backup
        def mutate(*args):
            result = write(*args)
            self.source.versions["users/s/routines/original"] += timedelta(seconds=1)
            return result
        with patch.object(restore, "write_backup", side_effect=mutate), self.assertRaises(restore.SafetyError):
            restore.apply_restore(self.source, self.target, "s", "t", original, self.backup)
        self.assertTrue(self.backup.exists())
        self.assertEqual(self.target.writes, [])

    def test_active_sessions_private_media_bounds_and_reviewed_counts_are_explicit(self):
        self.source.docs["users/s/workout_sessions/active"] = {"status": "active"}
        self.source.versions["users/s/workout_sessions/active"] = NOW
        original = restore.inventory(self.source, "s")
        self.assertEqual(original.active_sessions, 1)
        self.assertEqual(len(original.records), 2)
        with self.assertRaises(restore.SafetyError):
            restore.apply_restore(self.source, self.target, "s", "t", original, self.backup)
        with self.assertRaises(restore.SafetyError): restore.check_expected_counts(original, 2, 1)
        private = {"days": [{"exercises": [{"gif_url": f"https://firebasestorage.googleapis.com/v0/b/{restore.PRODUCTION_PROJECT}.appspot.com/o/users%2Fs%2Fprivate.gif?token=never-log"}]}]}
        self.assertEqual(len(restore._private_media(private, "s")), 1)
        original.private_media, original.active_sessions = 1, 0
        with self.assertRaises(restore.SafetyError): restore.apply_restore(self.source, self.target, "s", "t", original, self.backup)
        docs = {f"users/s/routines/r{i}": {"created_at": NOW} for i in range(50)}
        with self.assertRaises(restore.SafetyError): restore.inventory(Database(restore.PRODUCTION_PROJECT, docs), "s")


if __name__ == "__main__":
    unittest.main()
