"""
Daily call quotas for the metered "live AI demo".

Approved users bypass all metering. Everyone else (trial users trying the real
AI with sample data) is limited to a fixed number of AI calls per day, with a
global daily ceiling and an admin killswitch. Counters live in Firestore and
reset by calendar date (UTC).

This is a coarse *call-count* guard sized to stay well under budget; the
authoritative dollar cap is a Cloud Billing budget that flips
``app_config/demo_ai.enabled`` to ``false`` (the killswitch below) when the
day's spend crosses the limit. ``MAX_OUTPUT_TOKENS`` bounds each call's output
so per-call cost is predictable.
"""
from datetime import date

from firebase_admin import firestore as fs
from firebase_functions import https_fn
from google.cloud.firestore_v1 import transactional

# ── Tunables (adjust to taste / current model pricing) ───────────────────────
PER_USER_DAILY = 15        # AI actions per trial user per day
GLOBAL_DAILY = 150         # ceiling across all trial users per day
MAX_OUTPUT_TOKENS = 800    # cap each call's output (bounds its cost)

_APPROVED = "approved"
_USER_DOC = "demo_ai_usage/{uid}"
_GLOBAL_DOC = "app_config/demo_ai_usage"   # not demo_ai_usage/__global__ (reserved id)
_SWITCH_DOC = "app_config/demo_ai"


def _today() -> str:
    return date.today().isoformat()


def _is_approved(db, uid: str) -> bool:
    """Approved users get the full app and skip demo metering entirely."""
    try:
        snap = db.document(f"user_status/{uid}").get()
        return bool(snap.exists and (snap.to_dict() or {}).get("status") == _APPROVED)
    except Exception:
        # Fail closed to *metered* (safer for cost) rather than granting access.
        return False


def _demo_ai_enabled(db) -> bool:
    """Killswitch: demo AI is on unless explicitly disabled (default on)."""
    try:
        snap = db.document(_SWITCH_DOC).get()
        if not snap.exists:
            return True
        return (snap.to_dict() or {}).get("enabled", True) is not False
    except Exception:
        return True


def _current(snap, day: str) -> int:
    """Stored count for `day`, treating a stale-date doc as zero (daily reset)."""
    data = snap.to_dict() or {}
    return data.get("count", 0) if data.get("date") == day else 0


def enforce_ai_quota(uid: str) -> None:
    """Meter one AI call for a trial user.

    No-op for approved users. Otherwise raises RESOURCE_EXHAUSTED when the demo
    AI is switched off, or when the per-user or global daily allowance is spent.
    On rejection nothing is incremented, so a blocked call doesn't burn quota.
    """
    db = fs.client()

    if _is_approved(db, uid):
        return

    if not _demo_ai_enabled(db):
        raise https_fn.HttpsError(
            code=https_fn.FunctionsErrorCode.RESOURCE_EXHAUSTED,
            message="The live AI demo is paused right now — try the simulated demo instead.",
        )

    day = _today()
    user_ref = db.document(_USER_DOC.format(uid=uid))
    global_ref = db.document(_GLOBAL_DOC)

    @transactional
    def _run(txn):
        # All reads must precede all writes in a Firestore transaction.
        g_snap = global_ref.get(transaction=txn)
        u_snap = user_ref.get(transaction=txn)
        g_count = _current(g_snap, day)
        u_count = _current(u_snap, day)

        if g_count >= GLOBAL_DAILY:
            raise https_fn.HttpsError(
                code=https_fn.FunctionsErrorCode.RESOURCE_EXHAUSTED,
                message="The demo's daily AI budget is used up — please try again tomorrow.",
            )
        if u_count >= PER_USER_DAILY:
            raise https_fn.HttpsError(
                code=https_fn.FunctionsErrorCode.RESOURCE_EXHAUSTED,
                message=(
                    f"You've used your {PER_USER_DAILY} free AI actions for today. "
                    "Switch to the simulated demo, or come back tomorrow."
                ),
            )

        txn.set(global_ref, {"date": day, "count": g_count + 1})
        txn.set(user_ref, {"date": day, "count": u_count + 1})

    _run(db.transaction())
