"""Copy one verified person's routines and completed workouts from production to QA.

Dry-run is the default. This tool never writes source data, profile, daily logs,
measurements or AI jobs. Apply uses create-only writes after a private typed backup.
"""
from __future__ import annotations

import argparse
import base64
from dataclasses import dataclass
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sys
from urllib.parse import unquote, urlparse
import uuid

from seed_qa import ROOT, PRODUCTION_PROJECT, SafetyError, guard_qa_project, initialize_admin, private_file_path

LIMIT = 50
MAX_TRANSFER_BYTES = 8 * 1024 * 1024


@dataclass
class Record:
    collection: str
    identifier: str
    value: dict
    snapshot: object

    def path(self, uid):
        return f"users/{uid}/{self.collection}/{self.identifier}"


@dataclass
class Inventory:
    records: list[Record]
    active_sessions: int
    unknown_sessions: int
    private_media: int


class NativeSnapshot:
    """Keep the original wire document: SDK DocumentSnapshot deepcopy loses nanos."""
    def __init__(self, reference, document=None):
        from google.cloud.firestore_v1 import _helpers
        self.reference, self.id = reference, reference.id
        self.exists, self.raw_document = document is not None, document
        self.create_time = document.create_time if document is not None else None
        self.update_time = document.update_time if document is not None else None
        self._value = _helpers.decode_dict(document.fields, reference._client) if document is not None else None

    def to_dict(self):
        # These values are read-only here; never deepcopy Firestore timestamps.
        return self._value


def read_documents(db, references, transaction=None):
    """Raw SDK reads preserve fields and register the same server transaction read set."""
    if not references:
        return []
    prefix = db._database_string + "/documents/"
    request = {"database": db._database_string, "documents": [reference._document_path for reference in references]}
    if transaction is not None:
        request["transaction"] = transaction.id
    found = {}
    for response in db._firestore_api.batch_get_documents(request=request):
        name = response.found.name or response.missing
        if not name.startswith(prefix) or name not in request["documents"]:
            raise SafetyError("The raw document response is outside the guarded client scope.")
        ref = db.document(name[len(prefix):])
        found[name] = NativeSnapshot(ref, response.found if response.found.name else None)
    if len(found) != len(references):
        raise SafetyError("The raw document read did not return the complete bounded inventory.")
    return [found[reference._document_path] for reference in references]


def _raw_fields(snapshot):
    from google.cloud.firestore_v1.types import Document
    return Document.pb(Document(fields=snapshot.raw_document.fields)).SerializeToString(deterministic=True)


def _raw_version(snapshot):
    from google.cloud.firestore_v1.types import Document
    return Document.pb(snapshot.raw_document).update_time.SerializeToString()


def queue_create(transaction, reference, snapshot):
    from google.cloud.firestore_v1.types import Document, Precondition, Write
    # Write original fields directly. This preserves every Firestore type and
    # nanosecond, including types that a native decode/encode could change.
    transaction._add_write_pbs([Write(update=Document(name=reference._document_path, fields=snapshot.raw_document.fields),
                                      current_document=Precondition(exists=False))])


def validate_scope(source_project, target_project, confirmation, source_uid, target_uid):
    if source_project != PRODUCTION_PROJECT:
        raise SafetyError("Source must be the exact production project.")
    if guard_qa_project(target_project, confirmation) != "cloud":
        raise SafetyError("Target must be a dedicated cloud QA project.")
    for uid in (source_uid, target_uid):
        if not isinstance(uid, str) or not 1 <= len(uid) <= 128 or "/" in uid or uid.strip() != uid:
            raise SafetyError("Explicit source and target Auth UIDs are required.")


def verify_identity(source_user, target_user):
    def google(user):
        if user.disabled or not user.email_verified or not user.email:
            raise SafetyError("Both Auth users must be enabled and email-verified.")
        identities = [provider.uid for provider in user.provider_data if provider.provider_id == "google.com"]
        if len(identities) != 1 or not identities[0]:
            raise SafetyError("Both Auth users must have one verified Google identity.")
        return identities[0]
    if (google(source_user) != google(target_user)
            or source_user.email.casefold() != target_user.email.casefold()):
        raise SafetyError("Source and target must represent the same verified Google account.")


def _typed_bytes(value):
    from google.cloud.firestore_v1 import _helpers
    from google.cloud.firestore_v1.types import Document
    return Document.pb(Document(fields=_helpers.encode_dict(value))).SerializeToString(deterministic=True)


def typed_equal(left, right):
    return _typed_bytes(left) == _typed_bytes(right)


def _private_media(value, source_uid):
    buckets = {f"{PRODUCTION_PROJECT}.appspot.com", f"{PRODUCTION_PROJECT}.firebasestorage.app"}
    found = set()
    def scan(item, media=False):
        if isinstance(item, dict):
            for key, child in item.items():
                scan(child, key in {"gif_url", "images"})
        elif isinstance(item, list):
            for child in item:
                scan(child, media)
        elif media and isinstance(item, str):
            parsed = urlparse(item)
            path = unquote(parsed.path)
            if (item.startswith(f"users/{source_uid}/") or (parsed.scheme == "gs" and parsed.netloc in buckets)
                    or parsed.hostname in {f"{bucket}.storage.googleapis.com" for bucket in buckets}
                    or (parsed.hostname in {"firebasestorage.googleapis.com", "storage.googleapis.com", "storage.cloud.google.com"}
                        and any(f"/{bucket}/" in path for bucket in buckets))):
                found.add(item)
    scan(value)
    return found


def inventory(db, uid):
    records, active, unknown, media = [], 0, 0, set()
    routines = list(db.collection(f"users/{uid}/routines").limit(LIMIT).stream())
    sessions = list(db.collection(f"users/{uid}/workout_sessions").limit(LIMIT).stream())
    if len(routines) >= LIMIT or len(sessions) >= LIMIT:
        raise SafetyError("Inventory reached its 50-document bound; review a narrower transfer scope.")
    routines = read_documents(db, [snapshot.reference for snapshot in routines])
    sessions = read_documents(db, [snapshot.reference for snapshot in sessions])
    routine_ids = {snapshot.id for snapshot in routines}
    for collection, snapshots in (("routines", routines), ("workout_sessions", sessions)):
        for snapshot in snapshots:
            value = snapshot.to_dict()
            if not isinstance(value, dict) or snapshot.update_time is None:
                raise SafetyError("Source inventory has an invalid document or missing version.")
            if collection == "workout_sessions" and value.get("status") != "completed":
                active += value.get("status") == "active"
                unknown += value.get("status") != "active"
                continue
            if value.get("id") not in (None, snapshot.id):
                raise SafetyError("A stored record ID differs from its document ID; review its linkage.")
            if collection == "routines":
                if "created_at" not in value:
                    raise SafetyError("A routine is missing created_at and would be hidden by the app query.")
            else:
                if value.get("routine_id") not in routine_ids:
                    raise SafetyError("A completed workout references a missing routine; review its linkage.")
                measured = value.get("date")
                try:
                    if not isinstance(measured, str) or datetime.strptime(measured, "%Y-%m-%d").strftime("%Y-%m-%d") != measured:
                        raise ValueError()
                except ValueError:
                    raise SafetyError("A completed workout has no valid original calendar date.") from None
            media.update(_private_media(value, uid))
            records.append(Record(collection, snapshot.id, value, snapshot))
    if sum(len(_raw_fields(record.snapshot)) for record in records) > MAX_TRANSFER_BYTES:
        raise SafetyError("The typed transfer exceeds the bounded transaction size.")
    return Inventory(sorted(records, key=lambda record: (record.collection, record.identifier)), active, unknown, len(media))


def _same_inventory(before, after):
    return (before.active_sessions == after.active_sessions and before.unknown_sessions == after.unknown_sessions
            and len(before.records) == len(after.records)
            and all((a.collection, a.identifier) == (b.collection, b.identifier)
                    and _raw_version(a.snapshot) == _raw_version(b.snapshot)
                    and _raw_fields(a.snapshot) == _raw_fields(b.snapshot) for a, b in zip(before.records, after.records)))


def _approved(owner, status):
    return owner.exists or (status.exists and (status.to_dict() or {}).get("status") == "approved")


def _paused(snapshot):
    return not snapshot.exists or (snapshot.to_dict() or {}).get("enabled") is not True


def check_target(db, uid, records, transaction=None):
    read = lambda path: db.document(path).get(transaction=transaction) if transaction else db.document(path).get()
    owner, status, control = [read(path) for path in (f"admins/{uid}", f"user_status/{uid}", "runtime_controls/qa_ai")]
    if not _approved(owner, status):
        raise SafetyError("Target Auth user needs approved access or the existing owner role.")
    if not _paused(control):
        raise SafetyError("Pause the QA AI control before restoring training records.")
    targets = read_documents(db, [db.document(record.path(uid)) for record in records], transaction=transaction)
    for record, target in zip(records, targets):
        if target.exists and _raw_fields(record.snapshot) != _raw_fields(target):
            raise SafetyError("A different target document already uses a source ID. Nothing will be overwritten.")
    return targets


def _backup_document(snapshot):
    if not snapshot.exists:
        return {"path": snapshot.reference.path, "exists": False}
    from google.cloud.firestore_v1.types import Document
    # Raw protobuf preserves every Firestore type, bytes, references and timestamp
    # nanoseconds without the lossy default=str JSON serialization pattern.
    return {"path": snapshot.reference.path, "exists": True,
            "firestore_document_proto_base64": base64.b64encode(Document.serialize(snapshot.raw_document)).decode("ascii")}


def write_backup(path, source_project, target_project, source_uid, target_uid, records, targets):
    path = private_file_path(path)
    if path.exists():
        raise SafetyError("The private backup path already exists; choose a new path.")
    payload = {"schema_version": 1, "format": "google.firestore.v1.Document/base64",
               "source_project": source_project, "target_project": target_project,
               "source_uid": source_uid, "target_uid": target_uid,
               "created_at": datetime.now(timezone.utc).isoformat(),
               "source": [_backup_document(record.snapshot) for record in records],
               "target_before": [_backup_document(snapshot) for snapshot in targets]}
    # Exclusive creation protects a previous backup even if another process
    # creates the explicitly named path after the initial existence check.
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
        json.dump(payload, stream, separators=(",", ":"))
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.chmod(path, 0o600)
    return path


def apply_restore(source_db, target_db, source_uid, target_uid, original, backup_path):
    validate_scope(source_db.project, target_db.project, target_db.project, source_uid, target_uid)
    if source_db.project != PRODUCTION_PROJECT or source_db.project == target_db.project:
        raise SafetyError("Named source and target clients do not match the guarded projects.")
    if original.active_sessions or original.unknown_sessions:
        raise SafetyError("Source has active or unknown-status workouts. Review them before a completed-history restore.")
    if original.private_media:
        raise SafetyError("Source-private media requires a separate reviewed media transfer; URLs were not rewritten.")
    if not original.records:
        raise SafetyError("There are no training records to restore.")
    targets = check_target(target_db, target_uid, original.records)
    path = write_backup(backup_path, source_db.project, target_db.project, source_uid, target_uid, original.records, targets)
    from firebase_admin import firestore as fs

    @fs.transactional
    def create(transaction):
        # Every target read precedes all writes; create() adds exists=false
        # preconditions, so concurrent target creation can never be overwritten.
        latest_targets = check_target(target_db, target_uid, original.records, transaction=transaction)
        if not _same_inventory(original, inventory(source_db, source_uid)):
            raise SafetyError("Source versions changed after inventory; rerun the dry-run.")
        missing = [(record, target) for record, target in zip(original.records, latest_targets) if not target.exists]
        for record, _ in missing:
            queue_create(transaction, target_db.document(record.path(target_uid)), record.snapshot)
        return len(missing)

    created = create(target_db.transaction())
    verify_restore(source_db, target_db, source_uid, target_uid, original)
    return created, path


def verify_restore(source_db, target_db, source_uid, target_uid, original):
    from google.cloud.firestore_v1.base_query import FieldFilter
    if not _same_inventory(original, inventory(source_db, source_uid)):
        raise SafetyError("Source changed during the cross-project copy. Review the private backup and QA readback.")
    targets = read_documents(target_db, [target_db.document(record.path(target_uid)) for record in original.records])
    for record, target in zip(original.records, targets):
        if not target.exists or _raw_fields(record.snapshot) != _raw_fields(target):
            raise SafetyError("Target readback differs from the original typed fields; review the private backup.")
    for routine_id in {record.value["routine_id"] for record in original.records if record.collection == "workout_sessions"}:
        rows = list(target_db.collection(f"users/{target_uid}/workout_sessions")
                    .where(filter=FieldFilter("routine_id", "==", routine_id)).order_by("date", direction="DESCENDING")
                    .order_by("__name__", direction="DESCENDING").limit(LIMIT).stream())
        ids = {snapshot.id for snapshot in rows}
        expected = {record.identifier for record in original.records if record.collection == "workout_sessions" and record.value["routine_id"] == routine_id}
        if not expected <= ids:
            raise SafetyError("The app's routine/date history query did not return every restored session.")


def summary(original, targets):
    return {"routines": sum(record.collection == "routines" for record in original.records),
            "completed_sessions": sum(record.collection == "workout_sessions" for record in original.records),
            "active_sessions_not_selected": original.active_sessions, "unknown_sessions_not_selected": original.unknown_sessions,
            "source_private_media": original.private_media,
            "create_count": sum(not snapshot.exists for snapshot in targets), "identical_count": sum(snapshot.exists for snapshot in targets)}


def check_expected_counts(original, routines=None, sessions=None):
    actual_routines = sum(record.collection == "routines" for record in original.records)
    actual_sessions = sum(record.collection == "workout_sessions" for record in original.records)
    if ((routines is not None and (routines < 0 or routines != actual_routines))
            or (sessions is not None and (sessions < 0 or sessions != actual_sessions))):
        raise SafetyError("Source routine/session counts differ from the explicitly reviewed scope.")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-project", default=PRODUCTION_PROJECT)
    parser.add_argument("--target-project", required=True)
    parser.add_argument("--confirm-target-project", required=True)
    parser.add_argument("--source-uid", required=True)
    parser.add_argument("--target-uid", required=True)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--expected-routines", type=int, help="Abort unless the source has exactly this reviewed routine count.")
    parser.add_argument("--expected-sessions", type=int, help="Abort unless the source has exactly this reviewed completed-session count.")
    parser.add_argument("--backup-file", help="New .json file inside the repository's ignored .qa folder.")
    args = parser.parse_args(argv)
    stage = "scope_validation"
    try:
        validate_scope(args.source_project, args.target_project, args.confirm_target_project, args.source_uid, args.target_uid)
        backup = private_file_path(args.backup_file) if args.backup_file else ROOT / ".qa" / "training-restore" / (datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex + ".json")
        if args.apply and backup.exists():
            raise SafetyError("The private backup path already exists; choose a new path.")
        stage = "identity_verification"
        from firebase_admin import auth, firestore
        source_app, target_app = initialize_admin(args.source_project), initialize_admin(args.target_project)
        source_db, target_db = firestore.client(app=source_app), firestore.client(app=target_app)
        if source_db.project != args.source_project or target_db.project != args.target_project:
            raise SafetyError("Named clients do not match the explicitly guarded project IDs.")
        verify_identity(auth.get_user(args.source_uid, app=source_app), auth.get_user(args.target_uid, app=target_app))
        stage = "read_only_inventory"
        original = inventory(source_db, args.source_uid)
        check_expected_counts(original, args.expected_routines, args.expected_sessions)
        targets = check_target(target_db, args.target_uid, original.records)
        report = {"action": "apply" if args.apply else "dry_run", **summary(original, targets)}
        if args.apply:
            stage = "backup_and_create_only_copy"
            created, path = apply_restore(source_db, target_db, args.source_uid, args.target_uid, original, backup)
            report.update(created=created, verified=True, backup_file=str(path))
        print(json.dumps(report, separators=(",", ":")))
        return 0
    except SafetyError as error:
        print(str(error), file=sys.stderr)
        return 2
    except Exception as error:
        # Never echo SDK exception payloads, Auth user records or training facts.
        print(f"Training restore failed at {stage} ({type(error).__name__}). Review the private backup before retrying an apply.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
