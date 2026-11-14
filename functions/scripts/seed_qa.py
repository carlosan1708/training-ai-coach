"""Explicit, project-guarded synthetic Firebase QA fixtures.

Passwords go to Secret Manager by default. This module has no import-time cloud
side effects; --dry-run performs project/scope checks without importing Firebase.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone

ROOT = Path(__file__).resolve().parents[2]
PRODUCTION_PROJECT = "ai-training-coach-6880b"
SECRET_NAME = "training-coach-qa-test-users"
EMULATOR_PROJECT = "demo-training-coach"
ACCOUNTS = {
    "owner": ("qa_owner", "owner@training-coach-qa.example.test", "QA Owner", "approved"),
    "approvedA": ("qa_approved_a", "athlete-a@training-coach-qa.example.test", "QA Athlete A", "approved"),
    "approvedB": ("qa_approved_b", "athlete-b@training-coach-qa.example.test", "QA Athlete B", "approved"),
    "pending": ("qa_pending", "pending@training-coach-qa.example.test", "QA Pending", "pending"),
    "rejected": ("qa_rejected", "rejected@training-coach-qa.example.test", "QA Rejected", "rejected"),
    "invitationRecipient": ("qa_invitation_recipient", "invited@training-coach-qa.example.test", "QA Invited", "pending"),
}
SCOPES = ["https://www.googleapis.com/auth/cloud-platform", "https://www.googleapis.com/auth/datastore",
          "https://www.googleapis.com/auth/firebase", "https://www.googleapis.com/auth/identitytoolkit",
          "https://www.googleapis.com/auth/userinfo.email"]


class SafetyError(RuntimeError):
    """A configuration failure whose message never includes credentials."""


def _loopback_endpoint(value):
    return bool(re.fullmatch(r"(?:localhost|127\.0\.0\.1|\[::1\]):[1-9][0-9]{0,4}", value or ""))


def guard_qa_project(project, confirmation, environ=None):
    environ = os.environ if environ is None else environ
    if not project or project != confirmation:
        raise SafetyError("--confirm-project must exactly match --project.")
    if project == EMULATOR_PROJECT:
        if not all(_loopback_endpoint(environ.get(key)) for key in
                   ("FIREBASE_AUTH_EMULATOR_HOST", "FIRESTORE_EMULATOR_HOST")):
            raise SafetyError("The demo project requires explicit loopback Auth and Firestore emulator hosts.")
        return "emulator"
    if (not re.fullmatch(r"[a-z][a-z0-9-]{5,29}", project)
            or project == PRODUCTION_PROJECT or "-qa-" not in project
            or re.search(r"(?:^|-)(?:prod|production)(?:-|$)", project)):
        raise SafetyError("Seeding is restricted to a dedicated -qa- project; production is forbidden.")
    if any(environ.get(key) for key in ("FIREBASE_AUTH_EMULATOR_HOST", "FIRESTORE_EMULATOR_HOST")):
        raise SafetyError("Emulator hosts are allowed only with the explicit demo project.")
    return "cloud"


def guard_run_id(run_id):
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}", run_id or ""):
        raise SafetyError("Use a run ID of 1–64 letters, digits, underscores or hyphens.")
    return run_id


def private_file_path(filename):
    target = Path(filename).resolve()
    root = (ROOT / ".qa").resolve()
    if not target.is_relative_to(root) or target == root or target.suffix != ".json":
        raise SafetyError("The explicit credentials file must be a JSON file inside the ignored .qa directory.")
    return target


def write_private_file(filename, payload):
    target = private_file_path(filename)
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".credentials-", dir=target.parent)
    try:
        os.chmod(temporary, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(payload, stream, indent=2)
            stream.write("\n")
        os.replace(temporary, target)
        os.chmod(target, 0o600)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def gcloud(arguments, *, input_text=None):
    executable = shutil.which("gcloud") or shutil.which("gcloud.cmd")
    if not executable:
        raise SafetyError("Install the Google Cloud CLI and authenticate before using cloud fixtures.")
    env = {key: value for key, value in os.environ.items() if key != "SSLKEYLOGFILE"}
    return subprocess.run([executable, *arguments, "--quiet"], input=input_text, text=True,
                          capture_output=True, check=False, env=env, timeout=120)


def initialize_admin(project, *, emulator=False):
    """Use ADC, then a captured short-lived gcloud token; never a JSON key."""
    import firebase_admin
    from firebase_admin import credentials
    if emulator:
        from google.auth.credentials import AnonymousCredentials
        google_credential = AnonymousCredentials()
    else:
        try:
            adc = credentials.ApplicationDefault()
            google_credential = adc.get_credential()
        except Exception:
            token_result = gcloud(["auth", "print-access-token"])
            if token_result.returncode or not token_result.stdout.strip():
                raise SafetyError("No usable ADC or active gcloud identity. Authenticate and retry.") from None
            from google.oauth2.credentials import Credentials
            google_credential = Credentials(token=token_result.stdout.strip(), scopes=SCOPES)
            google_credential.expiry = (datetime.now(timezone.utc) + timedelta(minutes=45)).replace(tzinfo=None)
    if google_credential is not None:
        # Identity Toolkit requires an explicit consumer/quota project for user
        # credentials. Bind it to the confirmed target, never the gcloud default.
        if not emulator and hasattr(google_credential, "with_quota_project"):
            google_credential = google_credential.with_quota_project(project)
        class CapturedCredential(credentials.Base):
            def get_credential(self):
                return google_credential
            def get_access_token(self):
                if not emulator and not google_credential.valid:
                    from google.auth.transport.requests import Request
                    google_credential.refresh(Request())
                return credentials.AccessTokenInfo(google_credential.token,
                                                  getattr(google_credential, "expiry", None))
        adc = CapturedCredential()
    return firebase_admin.initialize_app(adc, {"projectId": project}, name="qa-admin-" + secrets.token_hex(4))


def read_secret(project):
    describe = gcloud(["secrets", "describe", SECRET_NAME, "--project", project, "--format=value(name)"])
    if describe.returncode:
        if "NOT_FOUND" in describe.stderr:
            return None
        raise SafetyError("Cannot inspect the QA credentials secret. Check Secret Manager permissions.")
    result = gcloud(["secrets", "versions", "access", "latest", "--secret", SECRET_NAME, "--project", project])
    if result.returncode:
        if "NOT_FOUND" in result.stderr:
            return None
        raise SafetyError("Cannot access the QA credentials secret.")
    try:
        return json.loads(result.stdout)
    except (ValueError, TypeError):
        raise SafetyError("The QA credentials secret is not valid JSON; it was not overwritten.") from None


def write_secret(project, payload):
    describe = gcloud(["secrets", "describe", SECRET_NAME, "--project", project, "--format=value(name)"])
    if describe.returncode:
        if "NOT_FOUND" not in describe.stderr:
            raise SafetyError("Cannot inspect the QA credentials secret.")
        created = gcloud(["secrets", "create", SECRET_NAME, "--project", project,
                          "--replication-policy=automatic", "--labels=managed-by=training-coach-qa"])
        if created.returncode:
            raise SafetyError("Cannot create the QA credentials secret.")
    result = gcloud(["secrets", "versions", "add", SECRET_NAME, "--project", project, "--data-file=-"],
                    input_text=json.dumps(payload))
    if result.returncode:
        raise SafetyError("Cannot persist QA credentials. No Auth accounts have been changed.")


def validate_credentials(payload, project):
    if not isinstance(payload, dict) or payload.get("schemaVersion") != 1 or payload.get("projectId") != project:
        raise SafetyError("Stored test credentials belong to another project or schema.")
    users = payload.get("users")
    if not isinstance(users, dict):
        raise SafetyError("Stored test credentials have an invalid users object.")
    for role, user in users.items():
        if role not in ACCOUNTS:
            raise SafetyError("Stored credentials contain an unexpected account.")
        uid, email, _, _ = ACCOUNTS[role]
        if (not isinstance(user, dict) or user.get("uid") != uid or user.get("email") != email
                or not isinstance(user.get("password"), str) or len(user["password"]) < 20):
            raise SafetyError("Stored test credentials do not match the reserved synthetic accounts.")
    return payload


def fixture_documents(run_id, today=None):
    """Only inert documents: no logs, workout sessions, jobs, or AI calls."""
    today = today or datetime.now(timezone(timedelta(hours=-6))).date()
    now = datetime.now(timezone.utc)
    tags = {"synthetic": True, "is_test": True, "qa_run_id": run_id, "updated_at": now}
    documents = {}
    for role, (uid, email, name, status) in ACCOUNTS.items():
        documents["user_status/" + uid] = {
            **tags, "uid": uid, "email": email, "displayName": name, "status": status,
            "acquisition": "qa_seed", "created_at": now,
            **({"access_granted_at": now} if status == "approved" else {}),
        }
        if role == "owner":
            documents["admins/" + uid] = {**tags, "role": "owner", "created_at": now}
        if status != "approved":
            continue
        base = "users/" + uid
        documents[base + "/profile/data"] = {
            **tags, "name": name, "training_goal": "general", "equipment": "home",
            "training_days_per_week": 3, "session_length_min": 30, "movement_restrictions": "",
            "dietary_style": "omnivore", "intolerances": [], "disliked_foods": [],
            "preferred_cuisines": [], "meals_per_day": 3, "caloric_target": "auto",
            "health_notes": "", "units": "metric", "workout_weight_unit": "lb",
            "ui_language": "en", "response_language": "en", "coaching_tone": "friendly",
            "onboarding_complete": True, "created_at": now,
        }
        documents[base + "/routines/qa_baseline"] = {
            **tags, "name": name + " baseline routine", "description": "Synthetic QA training plan.",
            "session_count": 0, "created_at": now,
            "exercises": [{"id": "qa_squat", "name": "Bodyweight squat", "sets": 2, "reps": 10,
                           "weight_kg": 0, "weight_unit": "lb", "rest_sec": 60}],
        }
        for index, days_ago in enumerate((14, 0)):
            weight = (78 if role == "approvedA" else 88 if role == "approvedB" else 82) - index * 0.5
            documents[base + "/measurement_entries/qa_baseline_" + str(index)] = {
                **tags, "id": "qa_baseline_" + str(index), "measured_at": (today - timedelta(days=days_ago)).isoformat(),
                "source_name": name + " synthetic scale", "method": "manual", "confirmed": True,
                "metrics": [{"key": "weight_kg", "label": "Weight", "value": weight, "unit": "kg"},
                            {"key": "waist_cm", "label": "Waist", "value": 85 - index, "unit": "cm"}],
                "notes": "Synthetic fixture for " + run_id + ". No personal data or model output.",
                "revision": 1, "summary_status": "fixture", "created_at": now,
            }
        start = today - timedelta(days=today.weekday())
        # Prevent Dashboard's automatic report refresh from starting a paid model call.
        documents[base + "/weekly_reports/qa_seed_snapshot"] = {
            **tags, "week_start": start.isoformat(), "week_end": (start + timedelta(days=6)).isoformat(),
            "headline": "Synthetic QA baseline", "summary": "Seeded test report. No AI was invoked.",
            "wins": ["QA fixture loaded."], "focus_next_week": ["Verify the isolated QA application."],
            "stats": {"week_start": start.isoformat(), "week_end": (start + timedelta(days=6)).isoformat(),
                      "sessions": 0, "routines_done": [], "total_volume_kg": 0, "prev_volume_kg": 0},
            "created_at": now,
        }
    return documents


def allowed_fixture_path(path):
    if not isinstance(path, str) or ".." in path or "//" in path:
        return False
    parts = path.split("/")
    uids = {account[0] for account in ACCOUNTS.values()}
    if len(parts) == 2:
        return parts[0] in {"admins", "user_status"} and parts[1] in uids
    return (len(parts) == 4 and parts[0] == "users" and parts[1] in uids
            and parts[2] in {"profile", "routines", "measurement_entries", "weekly_reports"}
            and bool(re.fullmatch(r"[a-zA-Z0-9_-]+", parts[3])))


def cleanup_run(db, app, run_id):
    from firebase_admin import auth
    marker = db.document("qa_runs/" + run_id)
    snap = marker.get()
    data = snap.to_dict() if snap.exists else None
    if not data or data.get("synthetic") is not True or data.get("qa_run_id") != run_id:
        raise SafetyError("No matching synthetic QA run marker exists. Nothing was deleted.")
    paths = data.get("documents", [])
    created_uids = data.get("created_auth_uids", [])
    if not isinstance(paths, list) or not all(allowed_fixture_path(path) for path in paths):
        raise SafetyError("The run marker contains an unsafe document scope. Nothing was deleted.")
    accounts_by_uid = {value[0]: value for value in ACCOUNTS.values()}
    if not isinstance(created_uids, list) or not all(uid in accounts_by_uid for uid in created_uids):
        raise SafetyError("The run marker contains an unsafe Auth scope. Nothing was deleted.")
    deletions = []
    for path in paths:
        ref = db.document(path)
        current = ref.get()
        value = current.to_dict() if current.exists else None
        if value and value.get("synthetic") is True and value.get("qa_run_id") == run_id:
            deletions.append(ref)
    # Auth deletion is limited to accounts this run created, never a project-wide list.
    for uid in created_uids:
        try:
            user = auth.get_user(uid, app=app)
        except auth.UserNotFoundError:
            continue
        if user.email != accounts_by_uid[uid][1]:
            raise SafetyError("A reserved Auth UID no longer matches the synthetic account. Nothing was deleted.")
    for ref in deletions:
        ref.delete()
    for uid in created_uids:
        # A later seeding run may now own this shared stable fixture.
        status = db.document("user_status/" + uid).get()
        if status.exists and (status.to_dict() or {}).get("qa_run_id") != run_id:
            continue
        try:
            auth.delete_user(uid, app=app)
        except auth.UserNotFoundError:
            pass
    marker.delete()
    return len(deletions)


def seed(db, app, project, run_id, *, emulator=False, credentials_file=None, rotate=False):
    from firebase_admin import auth
    documents = fixture_documents(run_id)
    marker = db.document("qa_runs/" + run_id)
    previous_marker = marker.get()
    previous = previous_marker.to_dict() if previous_marker.exists else {}
    if previous and (previous.get("synthetic") is not True or previous.get("qa_run_id") != run_id):
        raise SafetyError("The run ID is already used by a different record.")
    existing = {}
    for role, (uid, email, _, _) in ACCOUNTS.items():
        try:
            user = auth.get_user(uid, app=app)
        except auth.UserNotFoundError:
            user = None
        if user and user.email != email:
            raise SafetyError("A reserved UID belongs to another account. No accounts were changed.")
        existing[role] = user
    for path in documents:
        current = db.document(path).get()
        if current.exists and (current.to_dict() or {}).get("synthetic") is not True:
            raise SafetyError("A fixture document is not marked synthetic. No accounts were changed.")
    if emulator and not credentials_file:
        raise SafetyError("Emulator fixtures require an explicit --credentials-file inside .qa.")
    if credentials_file:
        target = private_file_path(credentials_file)
        payload = json.loads(target.read_text(encoding="utf-8")) if target.exists() else None
    else:
        payload = read_secret(project)
    if payload is not None:
        validate_credentials(payload, project)
    else:
        payload = {"schemaVersion": 1, "projectId": project, "users": {}}
    changed = False
    for role, (uid, email, name, _) in ACCOUNTS.items():
        prior = payload["users"].get(role)
        if existing[role] and not prior and not rotate:
            raise SafetyError("An existing test account has no stored password. Use --rotate-passwords explicitly to recover it.")
        if prior is None or rotate:
            payload["users"][role] = {"uid": uid, "email": email, "displayName": name,
                                      "password": secrets.token_urlsafe(36)}
            changed = True
    if changed:
        payload.update(runId=run_id, generatedAt=datetime.now(timezone.utc).isoformat())
        if credentials_file:
            write_private_file(credentials_file, payload)
        else:
            write_secret(project, payload)
    created_uids = sorted(set(previous.get("created_auth_uids", [])) | {
        ACCOUNTS[role][0] for role, user in existing.items() if user is None})
    marker.set({"synthetic": True, "qa_run_id": run_id, "project_id": project, "status": "seeding",
                "created_auth_uids": created_uids, "documents": sorted(documents),
                "created_at": previous.get("created_at") or datetime.now(timezone.utc),
                "updated_at": datetime.now(timezone.utc)}, merge=True)
    for role, (uid, email, name, _) in ACCOUNTS.items():
        password = payload["users"][role]["password"]
        if existing[role]:
            # Reapply the same stored password; only --rotate-passwords generates a different one.
            auth.update_user(uid, password=password, display_name=name, email_verified=True, disabled=False, app=app)
        else:
            auth.create_user(uid=uid, email=email, password=password, display_name=name,
                             email_verified=True, disabled=False, app=app)
    batch = db.batch()
    for path, value in documents.items():
        batch.set(db.document(path), value)
    batch.set(marker, {"status": "ready", "updated_at": datetime.now(timezone.utc)}, merge=True)
    batch.commit()
    return len(documents)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True)
    parser.add_argument("--confirm-project", required=True)
    parser.add_argument("--run-id", default="seed-v1")
    parser.add_argument("--rotate-passwords", action="store_true")
    parser.add_argument("--credentials-file", help="Use only an explicit private JSON file inside ignored .qa (mode 0600), bypassing Secret Manager.")
    parser.add_argument("--publish-secret", action="store_true", help="Publish existing local credentials to QA Secret Manager only; no Auth/Firestore changes or rotation.")
    parser.add_argument("--cleanup-run", help="Delete only fixtures owned by this synthetic run marker.")
    parser.add_argument("--dry-run", action="store_true", help="Validate targets and show non-secret scope; no cloud calls.")
    args = parser.parse_args(argv)
    stage = "target_validation"
    try:
        mode = guard_qa_project(args.project, args.confirm_project)
        run_id = guard_run_id(args.cleanup_run or args.run_id)
        if args.credentials_file:
            private_file_path(args.credentials_file)
        if args.cleanup_run and args.rotate_passwords:
            raise SafetyError("Password rotation cannot be combined with cleanup.")
        if args.publish_secret and (mode == "emulator" or not args.credentials_file or args.cleanup_run or args.rotate_passwords):
            raise SafetyError("--publish-secret requires --credentials-file for a cloud QA seed.")
        if args.dry_run:
            print(json.dumps({"projectId": args.project, "mode": mode, "runId": run_id,
                              "action": "cleanup" if args.cleanup_run else "publish_credentials" if args.publish_secret else "seed",
                              "reservedAuthUids": [] if args.publish_secret else [value[0] for value in ACCOUNTS.values()],
                              "documentCount": 0 if args.publish_secret else len(fixture_documents(run_id)),
                              "credentialDestination": "explicit local file and Secret Manager" if args.publish_secret else "explicit local file" if args.credentials_file else "Secret Manager"}))
            return 0
        if args.publish_secret:
            stage = "credential_publication"
            payload = validate_credentials(json.loads(private_file_path(args.credentials_file).read_text(encoding="utf-8")), args.project)
            if set(payload["users"]) != set(ACCOUNTS):
                raise SafetyError("Publish only a complete set of the six reserved QA credentials.")
            write_secret(args.project, payload)
            print("Published the existing private QA credentials to Secret Manager. Auth accounts, Firestore fixtures and passwords were unchanged.")
            return 0
        if mode == "emulator" and not args.credentials_file and not args.cleanup_run:
            raise SafetyError("Emulator fixtures require an explicit --credentials-file inside .qa.")
        stage = "admin_authentication"
        app = initialize_admin(args.project, emulator=mode == "emulator")
        from firebase_admin import firestore
        stage = "firestore_client"
        db = firestore.client(app)
        if args.cleanup_run:
            stage = "run_scoped_cleanup"
            count = cleanup_run(db, app, run_id)
            print(f"Removed {count} matching fixture documents from QA run {run_id}; unrelated records were retained.")
        else:
            stage = "synthetic_fixture_seed"
            count = seed(db, app, args.project, run_id, emulator=mode == "emulator",
                         credentials_file=args.credentials_file, rotate=args.rotate_passwords)
            print(f"QA fixtures ready: {len(ACCOUNTS)} synthetic accounts, {count} inert documents, run {run_id}. Passwords were not printed.")
        return 0
    except SafetyError as error:
        print("QA safety check: " + str(error), file=sys.stderr)
        return 2
    except Exception as error:
        # SDK/subprocess exceptions can contain request bodies, tokens or credentials.
        code = getattr(error, "code", None)
        if callable(code):
            try:
                code = code()
            except Exception:
                code = None
        code = getattr(code, "name", code)
        safe_code = str(code) if isinstance(code, int) or (isinstance(code, str) and re.fullmatch(r"[A-Z][A-Z0-9_]{0,59}", code)) else "unavailable"
        print(f"QA operation failed at {stage}: {type(error).__name__} ({safe_code}). Check project APIs, billing and permissions; no secret details were logged.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
