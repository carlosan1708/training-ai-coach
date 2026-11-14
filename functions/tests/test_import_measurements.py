"""Offline safeguards for the explicitly reviewed Fitdays QA-only import."""
import contextlib
from copy import deepcopy
from datetime import datetime, timezone
import io
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import import_measurements as importer
import seed_qa
from test_restore_training import Database, Snapshot, native_clone

QA = "training-coach-qa-20261017"
NOW = datetime(2026, 10, 17, tzinfo=timezone.utc)


class ImportTransaction:
    def __init__(self, db):
        self.db, self.id, self.pending = db, b"import-transaction", []
    def create(self, reference, value):
        self.pending.append((reference.path, native_clone(value), True))
    def set(self, reference, value):
        self.pending.append((reference.path, native_clone(value), False))
    def commit(self):
        if any(create and path in self.db.docs for path, _, create in self.pending):
            raise AssertionError("create-only precondition violated")
        for path, value, _ in self.pending:
            self.db.docs[path], self.db.versions[path] = value, NOW
            self.db.writes.append(path)


def transactional(callback):
    def run(tx):
        result = callback(tx)
        tx.commit()
        return result
    return run


def envelope(count=2):
    return {"source_sha256": "a" * 64, "attachments": [{"storage_path": "users/owner/measurement_imports/reference.jpg", "role": "reference_only"}],
            "entries": [{"id": f"fitdays_{index}", "measured_at": "2026-10-16", "source_name": "Fitdays", "method": "bia",
                         "metrics": [{"key": "weight_kg", "value": 80 + index / 10, "unit": "kg", "raw_value": "80,0"}],
                         "notes": "CSV observation", "source_metadata": {"raw_timestamp": "16/10/2026 06:32:15", "cells": ["80,0"], "ranges": {"weight": "50–90"}, "targets": {"weight": 70}},
                         **({"storage_path": "users/owner/measurement_imports/reference.jpg"} if index == count - 1 else {})} for index in range(count)]}


class ImportMeasurementTests(unittest.TestCase):
    def setUp(self):
        self.db = Database(QA, {"admins/owner": {"role": "owner"}, "user_status/owner": {"status": "approved"},
                               "runtime_controls/qa_ai": {"enabled": False},
                               "users/owner/measurement_state/current": {"revision": 4},
                               "users/owner/measurement_memory/current": {"revision": 4, "status": "ready", "summary": "Old summary"}})
        self.db.transaction = lambda: ImportTransaction(self.db)
        self.prepared = importer.prepare(envelope(), "owner", 2)
        folder = seed_qa.ROOT / ".qa"
        folder.mkdir(exist_ok=True)
        self.folder = tempfile.TemporaryDirectory(prefix="measurement-import-test-", dir=folder)
        self.addCleanup(self.folder.cleanup)
        self.backup = Path(self.folder.name) / "backup.json"
        self.tx = patch("firebase_admin.firestore.transactional", transactional)
        self.tx.start(); self.addCleanup(self.tx.stop)

    def test_project_guard_fails_before_local_input_or_cloud_access(self):
        for project, confirmation in ((seed_qa.PRODUCTION_PROJECT, seed_qa.PRODUCTION_PROJECT), (QA, "wrong-qa-project")):
            with patch.object(importer, "initialize_admin") as initialize, contextlib.redirect_stderr(io.StringIO()):
                result = importer.main(["--project", project, "--confirm-project", confirmation, "--uid", "owner", "--input-file", ".qa/nonexistent.json"])
                self.assertEqual(result, 2)
                initialize.assert_not_called()

    def test_normalized_facts_provenance_and_reference_attachment_remain_separate(self):
        canonical = self.prepared["records"]["measurement_entries/fitdays_1"]
        self.assertEqual(canonical["metrics"][0]["value"], 80.1)
        self.assertEqual(canonical["source_metadata"], envelope()["entries"][1]["source_metadata"])
        self.assertEqual(len(self.prepared["entry_ids"]), 2)
        self.assertNotIn("targets", {metric["key"] for metric in canonical["metrics"]})
        from lib.measurements import entry_fact_summary, source_fingerprint, stable_id
        memory = self.prepared["records"]["measurement_memory/entry_" + stable_id("fitdays_1")]
        self.assertEqual(memory["summary"], entry_fact_summary(canonical, "es"))
        self.assertEqual(memory["facts_hash"], source_fingerprint([canonical]))
        self.assertEqual(memory["kind"], "facts-v2")

    def anthropometry(self):
        """Synthetic values only; never embed private PDF data in tests."""
        data = envelope(2)
        data["source_format"] = "charlie-anthropometry-pdf-v1"
        data["attachments"] = []
        for index, entry in enumerate(data["entries"]):
            sha = str(index + 1) * 64
            path = f"users/owner/measurement_imports/anthropometry/source-{index}.pdf"
            day = f"2026-01-{index + 1:02d}"
            data["attachments"].append({"content_type": "application/pdf", "role": "original_report", "sha256": sha, "storage_path": path})
            entry.update(id=f"anthro_{index}", measured_at=day, source_name="Charlie Nutrición y Ejercicio",
                         method="anthropometric", storage_path=path, source_metadata={"format": data["source_format"],
                         "report_date": day, "file_sha256": sha, "warnings": ["Invisible spreadsheet cells excluded."]})
            entry["metrics"] += [{"key": "jackson_pollock_body_fat_pct", "label": "Body fat (Jackson/Pollock)", "value": 15, "unit": "%"},
                                 {"key": "triceps_mm", "value": 8, "unit": "mm"}]
        return data

    def test_anthropometry_import_keeps_formula_and_source_distinct_and_is_idempotent(self):
        prepared = importer.prepare(self.anthropometry(), "owner", 2)
        self.assertTrue(prepared["import_id"].startswith("qa_charlie_"))
        entry = prepared["records"]["measurement_entries/anthro_0"]
        self.assertEqual(entry["method"], "anthropometric")
        self.assertEqual([metric["key"] for metric in entry["metrics"]], ["weight_kg", "jackson_pollock_body_fat_pct", "triceps_mm"])
        self.db.docs["users/owner/measurement_entries/existing_scale"] = {"source_name": "Fitdays", "value": "untouched"}
        result = importer.apply_import(self.db, "owner", prepared, self.backup)
        self.assertEqual((result["created"], result["revision"], result["jobs_created"]), (4, 5, 0))
        receipt = self.db.docs[f"users/owner/measurement_requests/{prepared['import_id']}"]
        self.assertEqual(receipt["kind"], "qa_charlie_anthropometry_import")
        self.assertEqual(self.db.docs["users/owner/measurement_entries/existing_scale"]["value"], "untouched")
        self.assertEqual(importer.apply_import(self.db, "owner", prepared, self.backup.with_name("repeat.json"))["created"], 0)

    def test_anthropometry_requires_matching_original_pdf_without_duplicate_reports_or_dates(self):
        source = self.anthropometry()
        for change in ("unknown_format", "missing_original", "wrong_pdf_type", "wrong_hash", "wrong_date", "wrong_path", "duplicate_report", "duplicate_date", "metadata_type"):
            data = deepcopy(source)
            if change == "unknown_format": data["source_format"] = "unreviewed"
            elif change == "missing_original": data["attachments"].pop()
            elif change == "wrong_pdf_type": data["attachments"][0]["content_type"] = "text/html"
            elif change == "wrong_hash": data["entries"][0]["source_metadata"]["file_sha256"] = "f" * 64
            elif change == "wrong_date": data["entries"][0]["source_metadata"]["report_date"] = "2026-02-01"
            elif change == "wrong_path": data["entries"][0]["storage_path"] = "users/other/measurement_imports/source.pdf"
            elif change == "duplicate_report":
                data["entries"][1]["source_metadata"]["file_sha256"] = data["entries"][0]["source_metadata"]["file_sha256"]
                data["entries"][1]["storage_path"] = data["entries"][0]["storage_path"]
            elif change == "duplicate_date":
                data["entries"][1]["measured_at"] = data["entries"][0]["measured_at"]
                data["entries"][1]["source_metadata"]["report_date"] = data["entries"][0]["measured_at"]
            else: data["entries"][0]["source_metadata"] = ["unreviewed"]
            with self.subTest(change=change), self.assertRaises(seed_qa.SafetyError):
                importer.prepare(data, "owner", 2)

    def test_bad_counts_duplicate_ids_nonfinite_and_wrong_attachment_are_rejected(self):
        for change in ("count", "duplicate", "nan", "path", "source"):
            data = envelope()
            if change == "count": data["entries"].pop()
            elif change == "duplicate": data["entries"][1]["id"] = data["entries"][0]["id"]
            elif change == "nan": data["entries"][0]["metrics"][0]["value"] = float("nan")
            elif change == "path": data["attachments"][0]["storage_path"] = "users/someone-else/measurement_imports/report.jpg"
            else: data["entries"][0]["source_name"] = "Other"
            with self.subTest(change=change), self.assertRaises(seed_qa.SafetyError): importer.prepare(data, "owner", 2)

    def test_dry_run_reads_only_and_prints_counts_without_private_measurements(self):
        input_file = Path(self.folder.name) / "input.json"
        input_file.write_text(json.dumps(envelope()), encoding="utf-8")
        account = SimpleNamespace(disabled=False, email_verified=True, email="owner@example.test", provider_data=[SimpleNamespace(provider_id="google.com", uid="same")])
        output = io.StringIO()
        with patch.object(importer, "initialize_admin", return_value=object()), patch("firebase_admin.firestore.client", return_value=self.db), \
                patch("firebase_admin.auth.get_user", return_value=account), contextlib.redirect_stdout(output):
            result = importer.main(["--project", QA, "--confirm-project", QA, "--uid", "owner", "--input-file", str(input_file), "--expected-entries", "2"])
        self.assertEqual(result, 0)
        self.assertEqual(self.db.writes, [])
        self.assertEqual(json.loads(output.getvalue())["create_count"], 4)
        self.assertNotIn("raw_timestamp", output.getvalue())
        self.assertFalse(self.backup.exists())

    def test_apply_is_atomic_with_factual_summaries_no_jobs_and_repeat_noop(self):
        result = importer.apply_import(self.db, "owner", self.prepared, self.backup)
        self.assertEqual((result["created"], result["revision"], result["jobs_created"]), (4, 5, 0))
        self.assertEqual(len(self.db.writes), 8)
        self.assertTrue(self.backup.exists())
        current = self.db.docs["users/owner/measurement_memory/current"]
        self.assertEqual((current["status"], current["summary"], current["error_reason"]), ("stale", "", "QA_AI_PAUSED"))
        self.assertFalse(any("measurement_jobs" in path for path in self.db.docs))
        self.assertTrue(all(path.startswith("users/owner/measurement_") or path.startswith("users/owner/progress_insights/") for path in self.db.writes))
        second = importer.apply_import(self.db, "owner", self.prepared, self.backup.with_name("unused.json"))
        self.assertEqual((second["created"], second["revision"]), (0, 5))
        self.assertEqual(len(self.db.writes), 8)
        self.assertFalse(self.backup.with_name("unused.json").exists())

    def test_reviewed_119_entry_import_stays_within_atomic_write_bound(self):
        prepared = importer.prepare(envelope(119), "owner", 119)
        result = importer.apply_import(self.db, "owner", prepared, self.backup)
        self.assertEqual((result["created"], len(self.db.writes)), (238, 242))
        self.assertEqual(sum("/measurement_entries/" in path for path in self.db.writes), 119)
        self.assertEqual(sum("/measurement_memory/entry_" in path for path in self.db.writes), 119)
        self.assertFalse(any("measurement_jobs" in path for path in self.db.docs))

    def test_closed_ai_owner_status_and_collisions_are_checked_before_backup(self):
        for change in ("ai", "owner", "status", "collision"):
            docs = native_clone(self.db.docs)
            if change == "ai": self.db.docs["runtime_controls/qa_ai"]["enabled"] = True
            elif change == "owner": self.db.docs.pop("admins/owner")
            elif change == "status": self.db.docs["user_status/owner"]["status"] = "pending"
            else: self.db.docs["users/owner/measurement_entries/fitdays_0"] = {"metrics": []}
            with self.subTest(change=change), self.assertRaises(seed_qa.SafetyError): importer.apply_import(self.db, "owner", self.prepared, self.backup)
            self.assertEqual(self.db.writes, [])
            self.assertFalse(self.backup.exists())
            self.db.docs = docs

    def test_edit_or_delete_after_import_is_never_silently_repaired(self):
        importer.apply_import(self.db, "owner", self.prepared, self.backup)
        path = "users/owner/measurement_entries/fitdays_0"
        original = native_clone(self.db.docs[path])
        self.db.docs[path]["revision"] = 2
        with self.assertRaises(seed_qa.SafetyError): importer.apply_import(self.db, "owner", self.prepared, self.backup.with_name("edit.json"))
        self.db.docs[path] = original
        self.db.docs.pop(path)
        with self.assertRaises(seed_qa.SafetyError): importer.apply_import(self.db, "owner", self.prepared, self.backup.with_name("delete.json"))
        self.assertEqual(len(self.db.writes), 8)

    def test_state_changed_after_backup_refuses_all_writes(self):
        original = importer.write_backup
        def changed(*args):
            result = original(*args)
            self.db.docs["users/owner/measurement_state/current"]["revision"] += 1
            return result
        with patch.object(importer, "write_backup", side_effect=changed), self.assertRaises(seed_qa.SafetyError):
            importer.apply_import(self.db, "owner", self.prepared, self.backup)
        self.assertTrue(self.backup.exists())
        self.assertEqual(self.db.writes, [])


if __name__ == "__main__": unittest.main()
