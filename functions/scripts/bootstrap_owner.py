"""Grant the server-owned owner role to one explicitly named existing Firebase UID.

This does not select the current CLI user, approve a group, modify Auth accounts,
or replace existing profile/status data. It is separate from QA account seeding.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import os
import re
import sys

from seed_qa import EMULATOR_PROJECT, SafetyError, guard_qa_project, initialize_admin


def validate_target(project, confirmation, uid, environ=None):
    environ = os.environ if environ is None else environ
    if not re.fullmatch(r"[a-z][a-z0-9-]{5,29}", project or "") or project != confirmation:
        raise SafetyError("Pass an explicit --project and matching --confirm-project.")
    if not uid or len(uid) > 128 or "/" in uid or any(character.isspace() for character in uid):
        raise SafetyError("Pass the exact existing Firebase Auth UID with --uid.")
    if project == EMULATOR_PROJECT:
        guard_qa_project(project, confirmation, environ)
        return "emulator"
    if any(environ.get(key) for key in ("FIREBASE_AUTH_EMULATOR_HOST", "FIRESTORE_EMULATOR_HOST")):
        raise SafetyError("Clear emulator hosts before bootstrapping a cloud owner.")
    return "cloud"


def bootstrap(db, auth, app, uid):
    # An explicit UID must exist in this exact project's Auth user store.
    user = auth.get_user(uid, app=app)
    if user.disabled:
        raise SafetyError("The explicitly named Auth account is disabled; no owner role was changed.")
    ref = db.document("admins/" + uid)
    if ref.get().exists:
        return False
    ref.create({"role": "owner", "created_at": datetime.now(timezone.utc),
                "bootstrap_source": "explicit_existing_uid"})
    return True


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True)
    parser.add_argument("--confirm-project", required=True)
    parser.add_argument("--uid", required=True, help="Existing Firebase Auth UID; no account is inferred.")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    try:
        mode = validate_target(args.project, args.confirm_project, args.uid)
        if args.dry_run:
            print(f"Target verified: {args.project}, document admins/{args.uid}. No cloud calls made.")
            return 0
        app = initialize_admin(args.project, emulator=mode == "emulator")
        from firebase_admin import auth, firestore
        created = bootstrap(firestore.client(app), auth, app, args.uid)
        print("Owner role created for the explicitly named existing account." if created
              else "Owner role already exists; no records changed.")
        return 0
    except SafetyError as error:
        print("Owner safety check: " + str(error), file=sys.stderr)
        return 2
    except Exception:
        print("Owner bootstrap failed. Check the exact project, UID and permissions; no credential details were logged.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
