"""Fail-closed, operator-only leases for paid AI in the isolated QA project.

Clients have no access to runtime_controls. Each real Responses request consumes
one permit transactionally; an operator must explicitly open a short test window.
"""
import os
from datetime import datetime, timedelta, timezone

from firebase_admin import firestore as fs
from firebase_functions import https_fn
from lib.qa_runtime import is_exact_qa_environment

QA_AI_CONTROL_PATH = "runtime_controls/qa_ai"
MAX_LEASE_MINUTES = 30
MAX_LEASE_CALLS = 20
ALLOWED_TASKS = frozenset(("general", "extraction", "progress"))
_PARKED_MESSAGE = "QA AI is paused. Ask to open a temporary test window."


def _blocked():
    return https_fn.HttpsError(https_fn.FunctionsErrorCode.FAILED_PRECONDITION, _PARKED_MESSAGE,
                              details={"reason": "QA_AI_PAUSED"})


def qa_ai_gate_required(environ=None):
    """Reject inconsistent QA markers rather than accidentally treating QA as production."""
    env = os.environ if environ is None else environ
    projects = [str(env.get(key) or "").strip() for key in ("GCLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT")]
    qa_project = str(env.get("QA_FIREBASE_PROJECT_ID") or "").strip()
    qa_marked = (env.get("APP_ENV") == "qa" or any("-qa-" in project for project in projects)
                 or bool(qa_project and qa_project in projects))
    if not qa_marked:
        return False
    if not is_exact_qa_environment(env):
        raise _blocked()
    return True


def validate_qa_ai_lease(data, *, uid, task, project_id, now):
    """Validate trusted control data and return the remaining request budget."""
    if not isinstance(data, dict) or data.get("enabled") is not True or data.get("project_id") != project_id:
        raise _blocked()
    lease_id = data.get("lease_id")
    if not isinstance(lease_id, str) or not lease_id.strip() or len(lease_id) > 100:
        raise _blocked()
    issued, expires = data.get("issued_at"), data.get("expires_at")
    if (not isinstance(issued, datetime) or issued.tzinfo is None or not isinstance(expires, datetime)
            or expires.tzinfo is None or not issued <= now < expires
            or not timedelta(0) < expires - issued <= timedelta(minutes=MAX_LEASE_MINUTES)):
        raise _blocked()
    allowed_uids = data.get("allowed_uids")
    if (not isinstance(allowed_uids, list) or not 1 <= len(allowed_uids) <= 10
            or any(not isinstance(value, str) or not value.strip() or len(value) > 128 for value in allowed_uids)
            or len(set(allowed_uids)) != len(allowed_uids) or not uid or uid not in allowed_uids):
        raise _blocked()
    tasks = data.get("allowed_tasks")
    if (not isinstance(tasks, list) or not tasks or any(not isinstance(value, str) for value in tasks)
            or not set(tasks) <= ALLOWED_TASKS or task not in tasks):
        raise _blocked()
    remaining = data.get("remaining_calls")
    if not isinstance(remaining, int) or isinstance(remaining, bool) or not 1 <= remaining <= MAX_LEASE_CALLS:
        raise _blocked()
    consumed = data.get("consumed_calls", 0)
    if (not isinstance(consumed, int) or isinstance(consumed, bool) or consumed < 0
            or consumed + remaining > MAX_LEASE_CALLS):
        raise _blocked()
    return remaining


def enforce_qa_ai_lease(uid, task):
    if not qa_ai_gate_required():
        return
    project_id = os.environ["QA_FIREBASE_PROJECT_ID"].strip()
    try:
        db = fs.client()
        ref = db.document(QA_AI_CONTROL_PATH)

        @fs.transactional
        def consume(transaction):
            # Read on every provider call, including every graph node. Never
            # positively cache a grant: revocation takes effect on the next call.
            snapshot = ref.get(transaction=transaction)
            data = snapshot.to_dict() if snapshot.exists else None
            remaining = validate_qa_ai_lease(data,
                uid=uid, task=task, project_id=project_id, now=datetime.now(timezone.utc))
            transaction.update(ref, {"remaining_calls": remaining - 1,
                                     "consumed_calls": data.get("consumed_calls", 0) + 1,
                                     "last_used_at": fs.SERVER_TIMESTAMP})

        consume(db.transaction())
    except https_fn.HttpsError:
        raise
    except Exception:
        # Configuration/store/transaction outages cannot activate paid AI.
        raise _blocked() from None
