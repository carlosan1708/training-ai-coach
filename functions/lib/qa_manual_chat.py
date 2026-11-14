"""Server-scoped QA chat: real users uncapped, synthetic demos budgeted."""
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
import os
import re
from threading import Lock

from firebase_admin import firestore as fs
from firebase_functions import https_fn
from lib.qa_ai_gate import qa_ai_gate_required

QA_PROJECT_ID = "training-coach-qa-20261017"
POLICY_PATH = "runtime_controls/qa_manual_chat"
USAGE_COLLECTION = "qa_manual_chat_usage"
REPORT_TIMEZONE = "America/Costa_Rica"
_COSTA_RICA = timezone(timedelta(hours=-6), REPORT_TIMEZONE)
_ACTIVE = ContextVar("qa_manual_chat", default=None)
_DEMO_UIDS = frozenset(("qa_owner", "qa_approved_a", "qa_approved_b", "qa_pending", "qa_rejected", "qa_invitation_recipient", "demo-user"))


def _paused():
    return https_fn.HttpsError(https_fn.FunctionsErrorCode.FAILED_PRECONDITION,
                              "QA AI is paused. Manual chat is not enabled for this account.",
                              details={"reason": "QA_AI_PAUSED"})


def _limited():
    return https_fn.HttpsError(https_fn.FunctionsErrorCode.RESOURCE_EXHAUSTED,
                              "The manual QA chat allowance is used. Try again tomorrow.",
                              details={"reason": "QA_MANUAL_CHAT_LIMIT"})


def _now():
    return datetime.now(timezone.utc)


def clear_manual_chat_scope():
    """Defensively discard a stale marker when a new callable binds its user."""
    _ACTIVE.set(None)


def _qa_project():
    if not qa_ai_gate_required():
        return None
    if os.environ.get("QA_FIREBASE_PROJECT_ID", "").strip() != QA_PROJECT_ID:
        raise _paused()
    return QA_PROJECT_ID


def _validate_policy(policy, project):
    limit = (policy or {}).get("demo_daily_messages")
    if (not isinstance(policy, dict) or policy.get("enabled") is not True
            or policy.get("project_id") != project or policy.get("timezone") != REPORT_TIMEZONE
            or type(limit) is not int or not 1 <= limit <= 10):
        raise _paused()
    return limit


def _policy(db, uid, project, transaction=None):
    def read(path):
        return db.document(path).get(transaction=transaction) if transaction is not None else db.document(path).get()
    policy, owner, status = [read(path) for path in (POLICY_PATH, f"admins/{uid}", f"user_status/{uid}")]
    if not policy.exists:
        return None, 0  # Explicit operator leases remain independently usable.
    value, role = status.to_dict() or {}, owner.to_dict() or {}
    if value.get("status") != "approved":
        return None, 0
    invitation = {}
    invite_id = value.get("invitation_id")
    if isinstance(invite_id, str) and re.fullmatch(r"[a-f0-9]{32}", invite_id):
        snapshot = read(f"invitations/{invite_id}")
        invitation = snapshot.to_dict() or {}
    def synthetic(row):
        return (row.get("synthetic") is True or row.get("is_test") is True
                or bool(row.get("qa_run_id")) or row.get("acquisition") == "qa_seed"
                or str(row.get("email", "")).casefold().endswith("@training-coach-qa.example.test"))
    demo = uid in _DEMO_UIDS or any(synthetic(row) for row in (value, role, invitation))
    invited = (invitation.get("status") == "accepted" and invitation.get("accepted_by") == uid
               and isinstance(value.get("email"), str) and bool(value["email"])
               and str(invitation.get("email", "")).casefold() == value["email"].casefold())
    category = "demo" if demo else "real" if owner.exists or invited else None
    if category is None:
        return None, 0
    configuration = policy.to_dict()
    limit = _validate_policy(configuration, project)
    if category == "real" and configuration.get("real_users_unlimited") is not True:
        raise _paused()
    return category, limit


@dataclass
class _Reservation:
    uid: str
    project: str
    category: str
    remaining_calls: int = 2
    active: bool = True
    # LangGraph copies ContextVars between node contexts. The shared object and
    # lock preserve one request's two-call ceiling across those context copies.
    lock: object = field(default_factory=Lock)


@contextmanager
def qa_manual_chat_scope(uid):
    """Reserve one manual message only when entered by the authenticated chat route."""
    project = _qa_project()
    if project is None:
        yield
        return
    if (not isinstance(uid, str) or not 1 <= len(uid) <= 128 or "/" in uid
            or any(character.isspace() for character in uid) or _ACTIVE.get() is not None):
        raise _paused()
    try:
        db = fs.client()
        category, _ = _policy(db, uid, project)
        now = _now()
        day = now.astimezone(_COSTA_RICA).date().isoformat()
        ref = db.document(f"{USAGE_COLLECTION}/{uid}_{day}")

        @fs.transactional
        def reserve(tx):
            current_category, limit = _policy(db, uid, project, tx)
            if current_category != "demo":
                raise _paused()
            snapshot = ref.get(transaction=tx)
            usage = snapshot.to_dict() if snapshot.exists else {}
            used = usage.get("messages", 0)
            if (type(used) is not int or used < 0 or used > 10 or (snapshot.exists and
                    (usage.get("project_id") != project or usage.get("uid") != uid or usage.get("date") != day))):
                raise _paused()
            if used >= limit:
                raise _limited()
            tx.set(ref, {"project_id": project, "uid": uid, "date": day,
                         "messages": used + 1, "updated_at": fs.SERVER_TIMESTAMP})

        if category == "demo":
            reserve(db.transaction())
    except https_fn.HttpsError:
        raise
    except Exception:
        raise _paused() from None
    if category is None:
        # Unknown approval provenance grants nothing; explicit operator journeys
        # still reach the ordinary, independently validated QA lease.
        yield
        return
    reservation = _Reservation(uid, project, category)
    token = _ACTIVE.set(reservation)
    try:
        yield
    finally:
        with reservation.lock:
            reservation.active = False
        _ACTIVE.reset(token)


def consume_manual_chat_permit(uid, task):
    """True for one scoped provider attempt; False preserves the ordinary QA gate."""
    reservation = _ACTIVE.get()
    if reservation is None:
        return False
    if uid != reservation.uid or task not in {"general", "progress"} or _qa_project() != reservation.project:
        raise _paused()
    try:
        with reservation.lock:
            if not reservation.active:
                raise _paused()
            # A real account cannot change into a demo during a request and
            # retain the uncapped reservation, nor survive approval revocation.
            category, _ = _policy(fs.client(), uid, reservation.project)
            if category != reservation.category:
                raise _paused()
            if reservation.remaining_calls <= 0:
                raise _limited()
            reservation.remaining_calls -= 1
    except https_fn.HttpsError:
        raise
    except Exception:
        raise _paused() from None
    return True
