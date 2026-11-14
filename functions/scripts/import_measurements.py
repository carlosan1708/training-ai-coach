"""Import reviewed scale or anthropometry facts into one QA owner's workspace.

Dry-run by default. No model calls, jobs, source-project writes or existing-fact
updates. Source metadata is retained separately from normalized measured values.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import sys
import uuid

from seed_qa import ROOT, PRODUCTION_PROJECT, SafetyError, guard_qa_project, initialize_admin, private_file_path
from restore_training import _backup_document, read_documents, verify_identity

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lib.measurements import entry_fact_summary, normalize_entry, payload_hash, source_fingerprint, stable_id

MAX_ENTRIES = 200
MAX_BYTES = 8 * 1024 * 1024
IGNORED_TIMES = frozenset(("created_at", "updated_at", "summarized_at", "generated_at"))


def validate_scope(project, confirmation, uid):
    if guard_qa_project(project, confirmation) != "cloud":
        raise SafetyError("This import accepts only an explicitly confirmed cloud QA project.")
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", uid or ""):
        raise SafetyError("Pass the exact target Auth UID with --uid.")


def _storage_path(value, uid):
    if not isinstance(value, str) or not value.startswith(f"users/{uid}/measurement_imports/") or ".." in value:
        raise SafetyError("An attachment path is outside the target owner's measurement import folder.")
    return value


def prepare(envelope, uid, expected=119):
    if not isinstance(envelope, dict) or not re.fullmatch(r"[a-fA-F0-9]{64}", envelope.get("source_sha256", "")):
        raise SafetyError("The reviewed envelope needs the original source SHA-256.")
    entries = envelope.get("entries")
    if not isinstance(entries, list) or not 1 <= len(entries) <= MAX_ENTRIES or len(entries) != expected:
        raise SafetyError("Entry count differs from the explicitly reviewed scope (maximum 200).")
    # Reject non-JSON/NaN values and bound the complete provenance envelope.
    try:
        encoded = json.dumps(envelope, ensure_ascii=False, sort_keys=True, allow_nan=False).encode()
    except (TypeError, ValueError):
        raise SafetyError("The reviewed envelope must contain finite JSON values.") from None
    if len(encoded) > MAX_BYTES:
        raise SafetyError("The reviewed envelope exceeds the bounded import size.")
    source_sha256 = envelope["source_sha256"].lower()
    source_format = envelope.get("source_format", "fitdays-export-v1")
    if source_format not in {"fitdays-export-v1", "charlie-anthropometry-pdf-v1"}:
        raise SafetyError("The source format has not been reviewed for this importer.")
    anthropometry = source_format == "charlie-anthropometry-pdf-v1"
    import_id = ("qa_charlie_" if anthropometry else "qa_fitdays_") + stable_id(source_sha256)
    receipt_kind = "qa_charlie_anthropometry_import" if anthropometry else "qa_fitdays_import"
    attachments = envelope.get("attachments", [])
    report_sources = {}
    if anthropometry:
        if not isinstance(attachments, list) or len(attachments) != len(entries):
            raise SafetyError("Each reviewed anthropometry observation needs its original PDF.")
        for item in attachments:
            if (not isinstance(item, dict) or item.get("content_type") != "application/pdf"
                    or item.get("role") != "original_report"
                    or not re.fullmatch(r"[a-f0-9]{64}", str(item.get("sha256", "")))
                    or item["sha256"] in report_sources):
                raise SafetyError("Anthropometry originals need unique PDF hashes and report provenance.")
            report_sources[item["sha256"]] = _storage_path(item.get("storage_path"), uid)
    records, ids, reviewed_reports, reviewed_dates = {}, set(), set(), set()
    for original in entries:
        if not isinstance(original, dict):
            raise SafetyError("Every source entry must be an object.")
        identifier = original.get("id")
        if not isinstance(identifier, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,160}", identifier) or identifier in ids:
            raise SafetyError("Every source entry needs a unique, explicit safe ID.")
        ids.add(identifier)
        if not original.get("measured_at"):
            raise SafetyError("Every reviewed source observation must have a measurement date.")
        if anthropometry:
            metadata = original.get("source_metadata") or {}
            if (not isinstance(metadata, dict) or original.get("source_name") != "Charlie Nutrición y Ejercicio" or original.get("method") != "anthropometric"
                    or metadata.get("format") != source_format or metadata.get("report_date") != original["measured_at"]
                    or metadata.get("file_sha256") not in report_sources
                    or original.get("storage_path") != report_sources[metadata["file_sha256"]]):
                raise SafetyError("A reviewed anthropometry observation does not match its original PDF.")
            if metadata["file_sha256"] in reviewed_reports or original["measured_at"] in reviewed_dates:
                raise SafetyError("A reviewed report or visit date is duplicated; review before importing.")
            reviewed_reports.add(metadata["file_sha256"])
            reviewed_dates.add(original["measured_at"])
        elif original.get("source_name") != "Fitdays" or original.get("method") != "bia":
            raise SafetyError("Every scale entry must be dated Fitdays BIA data.")
        try:
            value = normalize_entry(original)
        except (ValueError, TypeError):
            raise SafetyError("A reviewed entry failed canonical measurement normalization.") from None
        metadata = original.get("source_metadata", {})
        if not isinstance(metadata, dict):
            raise SafetyError("Entry source_metadata must be a separate object.")
        value.update(id=identifier, revision=1, import_id=import_id, source_metadata=metadata)
        if original.get("storage_path"):
            value["storage_path"] = _storage_path(original["storage_path"], uid)
        summary = entry_fact_summary(value, "es")
        value.update(summary=summary, summary_status="ready", summary_model="facts-v2")
        memory = {"entry_id": identifier, "facts_hash": source_fingerprint([value]), "summary": summary,
                  "kind": "facts-v2", "language": "es", "model": "facts-v2"}
        records[f"measurement_entries/{identifier}"] = value
        records[f"measurement_memory/entry_{stable_id(identifier)}"] = memory
    # Provenance-only attachment metadata is retained intact, never interpreted
    # as measured values. Validate every explicit storage_path recursively.
    def attachment_paths(item):
        if isinstance(item, dict):
            for key, child in item.items():
                if key == "storage_path": _storage_path(child, uid)
                else: attachment_paths(child)
        elif isinstance(item, list):
            for child in item: attachment_paths(child)
    attachment_paths(envelope)
    # Firestore limits each document and the complete transaction. Leave space
    # for timestamps, the typed backup metadata and the four control documents.
    from google.cloud.firestore_v1 import _helpers
    from google.cloud.firestore_v1.types import Document
    sizes = [len(Document.serialize(Document(fields=_helpers.encode_dict(value)))) for value in records.values()]
    metadata = {key: value for key, value in envelope.items() if key != "entries"}
    metadata_size = len(Document.serialize(Document(fields=_helpers.encode_dict(metadata))))
    if len(records) + 4 > 450 or max([metadata_size, *sizes]) > 900_000 or sum(sizes) + metadata_size > 7_500_000:
        raise SafetyError("The prepared import exceeds the safe Firestore document or transaction bounds.")
    return {"source_sha256": source_sha256, "import_id": import_id, "receipt_kind": receipt_kind,
            "payload_hash": payload_hash(envelope), "records": records,
            "entry_ids": sorted(ids), "metadata": metadata}


def _static(value):
    return {key: item for key, item in value.items() if key not in IGNORED_TIMES}


def preflight(db, uid, prepared, transaction=None):
    base = f"users/{uid}"
    paths = [f"admins/{uid}", f"user_status/{uid}", "runtime_controls/qa_ai",
             f"{base}/measurement_state/current", f"{base}/measurement_memory/current",
             f"{base}/progress_insights/{prepared['import_id']}",
             f"{base}/measurement_requests/{prepared['import_id']}"]
    paths += [f"{base}/{suffix}" for suffix in prepared["records"]]
    snapshots = read_documents(db, [db.document(path) for path in paths], transaction)
    by_path = {snapshot.reference.path: snapshot for snapshot in snapshots}
    role, status, control = snapshots[:3]
    if not role.exists or not status.exists or (status.to_dict() or {}).get("status") != "approved":
        raise SafetyError("The target must already be an approved owner; no roles or statuses will be changed.")
    if not control.exists or (control.to_dict() or {}).get("enabled") is not False:
        raise SafetyError("Explicitly close the QA AI control before importing facts.")
    state = snapshots[3].to_dict() or {}
    revision = state.get("revision", 0)
    if type(revision) is not int or revision < 0:
        raise SafetyError("The target measurement revision is invalid.")
    receipt = snapshots[6].to_dict() if snapshots[6].exists else None
    if receipt and (receipt.get("kind") != prepared.get("receipt_kind", "qa_fitdays_import") or receipt.get("source_sha256") != prepared["source_sha256"]
                    or receipt.get("payload_hash") != prepared["payload_hash"] or receipt.get("entry_ids") != prepared["entry_ids"]
                    or type(receipt.get("revision")) is not int or receipt["revision"] < 1):
        raise SafetyError("The source receipt ID already belongs to a different reviewed payload.")
    missing = []
    for suffix, expected in prepared["records"].items():
        path = f"{base}/{suffix}"
        target = by_path[path]
        if target.exists:
            if _static(target.to_dict()) != expected:
                raise SafetyError("A target fact or summary was edited or differs from the source; nothing will be overwritten.")
        else:
            missing.append(path)
    if receipt and missing:
        raise SafetyError("A previously imported fact or summary was removed; it will not be restored silently.")
    if not receipt and snapshots[5].exists:
        raise SafetyError("The target insight receipt ID already exists without its import receipt.")
    return {"snapshots": snapshots, "revision": revision, "missing": missing, "receipt": receipt}


def write_backup(path, project, uid, prepared, before):
    path = private_file_path(path)
    payload = {"schema_version": 1, "kind": prepared.get("receipt_kind", "qa_fitdays_import"), "project_id": project, "uid": uid,
               "source_sha256": prepared["source_sha256"], "payload_hash": prepared["payload_hash"],
               "created_at": datetime.now(timezone.utc).isoformat(),
               "target_before": [_backup_document(snapshot) for snapshot in before["snapshots"]],
               "planned_records": prepared["records"], "source_metadata": prepared["metadata"]}
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
        json.dump(payload, stream, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        stream.write("\n"); stream.flush(); os.fsync(stream.fileno())
    os.chmod(path, 0o600)
    return path


def apply_import(db, uid, prepared, backup_path):
    validate_scope(db.project, db.project, uid)
    before = preflight(db, uid, prepared)
    if before["receipt"]:
        return {"created": 0, "revision": before["receipt"]["revision"], "identical": True, "verified": True, "jobs_created": 0}
    path = write_backup(backup_path, db.project, uid, prepared, before)
    from firebase_admin import firestore as fs
    base = f"users/{uid}"

    @fs.transactional
    def commit(tx):
        current = preflight(db, uid, prepared, tx)
        if current["receipt"]:
            return {"created": 0, "revision": current["receipt"]["revision"], "identical": True}
        # Never invalidate a concurrently generated or changed progress view
        # without a backup of the exact version being replaced.
        for old, new in zip(before["snapshots"][3:6], current["snapshots"][3:6]):
            if old.exists != new.exists or (old.exists and old.raw_document != new.raw_document):
                raise SafetyError("Measurement state changed after backup; rerun the dry-run.")
        revision, now = current["revision"] + 1, datetime.now(timezone.utc)
        for suffix, value in prepared["records"].items():
            target_path = f"{base}/{suffix}"
            if target_path not in current["missing"]: continue
            timestamps = {"created_at": now, "updated_at": now, "summarized_at": now} if suffix.startswith("measurement_entries/") else {"generated_at": now}
            tx.create(db.document(target_path), {**value, **timestamps})
        tx.set(db.document(f"{base}/measurement_state/current"), {"revision": revision, "updated_at": now})
        stale = {"status": "stale", "summary": "", "error_reason": "QA_AI_PAUSED",
                 "error": "La IA de QA está pausada. Los datos y sus resúmenes factuales están guardados.",
                 "model": "facts-v2", "import_id": prepared["import_id"]}
        tx.set(db.document(f"{base}/measurement_memory/current"), {**stale, "revision": revision, "generated_at": now})
        tx.create(db.document(f"{base}/progress_insights/{prepared['import_id']}"), {
            **stale, "revision": revision - 1, "created_at": now, "days": 90,
            "wins": [], "focus": [], "comparisons": [], "workouts": {}})
        tx.create(db.document(f"{base}/measurement_requests/{prepared['import_id']}"), {
            "kind": prepared.get("receipt_kind", "qa_fitdays_import"), "payload_hash": prepared["payload_hash"],
            "source_sha256": prepared["source_sha256"], "entry_ids": prepared["entry_ids"],
            "revision": revision, "source_metadata": prepared["metadata"], "created_at": now})
        return {"created": len(current["missing"]), "revision": revision, "identical": False}

    result = commit(db.transaction())
    verified = preflight(db, uid, prepared)
    if not verified["receipt"] or verified["missing"] or verified["receipt"].get("revision") != result["revision"]:
        raise SafetyError("Import readback did not match; review the private backup before retrying.")
    if not result["identical"]:
        memory, insight = [snapshot.to_dict() or {} for snapshot in verified["snapshots"][4:6]]
        if (verified["revision"] != result["revision"] or memory.get("revision") != result["revision"]
                or any(value.get("status") != "stale" or value.get("summary") != "" or value.get("error_reason") != "QA_AI_PAUSED"
                       for value in (memory, insight))):
            raise SafetyError("Progress invalidation readback changed; review the private backup before retrying.")
    result.update(verified=True, backup_file=str(path), jobs_created=0)
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("project", "confirm-project", "uid", "input-file"):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--expected-entries", type=int, default=119)
    parser.add_argument("--source-uid", help="Also compare the original production owner's verified Google identity.")
    parser.add_argument("--backup-file")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args(argv)
    stage = "scope_validation"
    try:
        validate_scope(args.project, args.confirm_project, args.uid)
        if args.source_uid and not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", args.source_uid):
            raise SafetyError("The explicit source UID is invalid.")
        input_path = private_file_path(args.input_file)
        if input_path.stat().st_size > MAX_BYTES:
            raise SafetyError("The reviewed input exceeds the bounded import size.")
        prepared = prepare(json.loads(input_path.read_text(encoding="utf-8-sig")), args.uid, args.expected_entries)
        backup = private_file_path(args.backup_file) if args.backup_file else ROOT / ".qa" / "measurement-import" / (uuid.uuid4().hex + ".json")
        if args.apply and backup.exists():
            raise SafetyError("Choose a new private backup path.")
        stage = "identity_verification"
        from firebase_admin import auth, firestore
        app = initialize_admin(args.project)
        db = firestore.client(app=app)
        if db.project != args.project:
            raise SafetyError("The named client does not match the exact target project.")
        user = auth.get_user(args.uid, app=app)
        verify_identity(user, user)
        if args.source_uid:
            source_app = initialize_admin(PRODUCTION_PROJECT)
            verify_identity(auth.get_user(args.source_uid, app=source_app), user)
        stage = "read_only_preflight"
        before = preflight(db, args.uid, prepared)
        report = {"action": "apply" if args.apply else "dry_run", "entries": len(prepared["entry_ids"]),
                  "create_count": len(before["missing"]), "identical": bool(before["receipt"]), "jobs_created": 0}
        if args.apply:
            stage = "backup_and_atomic_import"
            report.update(apply_import(db, args.uid, prepared, backup))
        print(json.dumps(report, separators=(",", ":")))
        return 0
    except SafetyError as error:
        print(str(error), file=sys.stderr)
        return 2
    except Exception as error:
        print(f"Measurement import failed at {stage} ({type(error).__name__}). Review the private backup before retrying.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
