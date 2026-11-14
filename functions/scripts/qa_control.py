"""Manually budget live QA AI; no import-time cloud access or model requests."""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sys
import uuid

from seed_qa import ACCOUNTS, SafetyError, guard_qa_project, initialize_admin

CONTROL_PATH = "runtime_controls/qa_ai"
TASKS = {"general", "extraction", "progress"}
APPROVED_FIXTURES = {value[0]: value[1] for value in ACCOUNTS.values() if value[3] == "approved"}


def validate_scope(project, confirmation, action, *, requested=None, uids=(), tasks=(), minutes=10, requests=4):
    if guard_qa_project(project, confirmation) != "cloud":
        raise SafetyError("This operator tool accepts only a dedicated cloud QA project.")
    if action in {"enable", "cleanup"} and requested != project:
        raise SafetyError("Manual QA work needs --run-requested with the exact QA project.")
    if action == "enable":
        if not uids or len(set(uids)) != len(uids) or any(uid not in APPROVED_FIXTURES for uid in uids):
            raise SafetyError("Choose unique approved synthetic UIDs with --uid.")
        if not tasks or len(set(tasks)) != len(tasks) or not set(tasks) <= TASKS:
            raise SafetyError("Choose unique --task values: general, extraction or progress.")
        if not 1 <= minutes <= 30 or not 1 <= requests <= 20:
            raise SafetyError("Use 1–30 minutes and 1–20 provider requests.")


def lease_document(project, uids, tasks, minutes, requests, now=None):
    now = now or datetime.now(timezone.utc)
    return {"enabled": True, "project_id": project, "lease_id": uuid.uuid4().hex,
            "issued_at": now, "expires_at": now + timedelta(minutes=minutes),
            "allowed_uids": list(uids), "allowed_tasks": list(tasks),
            "remaining_calls": requests, "consumed_calls": 0}


def status_document(value, project, now=None):
    """Return only known non-secret fields; never print an arbitrary document."""
    now = now or datetime.now(timezone.utc)
    value = value or {}
    issued, expires = value.get("issued_at"), value.get("expires_at")
    remaining = value.get("remaining_calls")
    uids, tasks = value.get("allowed_uids"), value.get("allowed_tasks")
    valid_time = (isinstance(issued, datetime) and issued.tzinfo is not None
                  and isinstance(expires, datetime) and expires.tzinfo is not None
                  and issued <= now < expires <= issued + timedelta(minutes=30))
    valid_scope = (isinstance(uids, list) and bool(uids) and len(set(str(uid) for uid in uids)) == len(uids)
                   and all(isinstance(uid, str) and uid in APPROVED_FIXTURES for uid in uids)
                   and isinstance(tasks, list) and bool(tasks) and len(set(str(task) for task in tasks)) == len(tasks)
                   and all(isinstance(task, str) and task in TASKS for task in tasks))
    active = (value.get("enabled") is True and value.get("project_id") == project
              and isinstance(value.get("lease_id"), str) and 0 < len(value["lease_id"]) <= 100
              and type(remaining) is int and 0 < remaining <= 20 and valid_time and valid_scope)
    return {"projectId": project, "active": bool(active),
            "remainingRequests": remaining if type(remaining) is int and 0 <= remaining <= 20 else 0,
            "expiresAt": expires.isoformat() if isinstance(expires, datetime) else None,
            "allowedUids": uids if valid_scope else [], "allowedTasks": tasks if valid_scope else []}


def verify_fixture_accounts(app, db, uids):
    from firebase_admin import auth
    for uid in uids:
        user = auth.get_user(uid, app=app)
        status = db.document("user_status/" + uid).get()
        role = db.document("admins/" + uid).get() if uid == "qa_owner" else None
        if (user.disabled or not user.email_verified or user.email != APPROVED_FIXTURES[uid]
                or not ((status.exists and (status.to_dict() or {}).get("status") == "approved")
                        or (role is not None and role.exists))):
            raise SafetyError("An allowed QA fixture account is absent, changed or not approved.")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("enable", "disable", "status", "cleanup"))
    parser.add_argument("--project", required=True)
    parser.add_argument("--confirm-project", required=True)
    parser.add_argument("--run-requested")
    parser.add_argument("--uid", action="append", default=[])
    parser.add_argument("--task", action="append", default=[])
    parser.add_argument("--minutes", type=int, default=10)
    parser.add_argument("--requests", type=int, default=4)
    parser.add_argument("--require-active", action="store_true")
    args = parser.parse_args(argv)
    try:
        validate_scope(args.project, args.confirm_project, args.action, requested=args.run_requested,
                       uids=args.uid, tasks=args.task, minutes=args.minutes, requests=args.requests)
    except SafetyError as error:
        print(str(error), file=sys.stderr)
        return 2
    try:
        from firebase_admin import firestore
        app = initialize_admin(args.project)
        db = firestore.client(app=app)
        ref = db.document(CONTROL_PATH)
        if args.action == "enable":
            verify_fixture_accounts(app, db, args.uid)
            ref.set(lease_document(args.project, args.uid, args.task, args.minutes, args.requests))
        elif args.action == "disable":
            ref.set({"enabled": False, "project_id": args.project,
                     "revoked_at": datetime.now(timezone.utc)})
        elif args.action == "cleanup":
            sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
            from usage_api import run_usage_cleanup
            # This helper removes only expired usage metadata in bounded batches.
            # It neither touches user health data nor creates AI jobs.
            run_usage_cleanup(db=db)
        snapshot = ref.get()
        status = status_document(snapshot.to_dict() if snapshot.exists else None, args.project)
        print(json.dumps(status, separators=(",", ":")))
        return 3 if args.require_active and not status["active"] else 0
    except Exception as error:
        # SDK exceptions may include credentials or server data. Never echo them.
        print("QA AI control failed (" + type(error).__name__ + "). Check operator access and QA setup.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
