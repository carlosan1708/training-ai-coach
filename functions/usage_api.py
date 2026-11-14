"""Private, allowlisted usage metadata. No health values, prompts, or URLs."""
import hashlib
import re
from collections import Counter
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from firebase_admin import firestore as fs
from firebase_functions import firestore_fn, https_fn, scheduler_fn
from google.cloud.firestore_v1.base_query import FieldFilter
from lib.access import require_approved, require_owner, is_owner
from access_api import APP_ENV
from lib.qa_runtime import is_qa_deployment_environment

try:
    REPORT_ZONE = ZoneInfo("America/Costa_Rica")
except ZoneInfoNotFoundError:
    # Windows developer installations may lack the optional IANA tzdata bundle.
    # Costa Rica uses UTC-06:00 without daylight-saving transitions.
    REPORT_ZONE = timezone(timedelta(hours=-6), "America/Costa_Rica")
SCREENS = frozenset(("home", "training", "workout", "history", "progress", "measurements", "checkin", "nutrition", "coach", "settings", "people", "invite"))
DOMAIN_EVENTS = frozenset(("workout_started", "workout_completed", "workout_canceled", "workout_edited", "workout_deleted", "checkin_saved", "routine_created", "report_uploaded", "measurement_saved", "measurement_deleted", "onboarding_completed", "ai_succeeded", "ai_failed"))
UI_ACTIONS = frozenset(("weight_edited", "reps_edited", "set_completion_toggled", "finish_clicked", "rest_paused", "rest_skipped", "workout_options", "exercise_options"))


def valid_ui_actions(actions):
    """Only bounded counters; never accept values, labels, IDs, or free text."""
    return (isinstance(actions, dict) and 0 < len(actions) <= len(UI_ACTIONS)
            and all(key in UI_ACTIONS and type(count) is int and 1 <= count <= 100 for key, count in actions.items()))


def reporting_day(at):
    return at.astimezone(REPORT_ZONE).date().isoformat()


def _utcnow():
    return datetime.now(timezone.utc)


def activity_transition(previous, event, at):
    """Pure session semantics, shared by event ingestion and offline tests."""
    previous = previous or {}
    last = previous.get("last_active")
    later = last is None or at > last
    new_session = last is None or at - last >= timedelta(minutes=30)
    result = {**previous, "first_seen": min(previous.get("first_seen") or at, at)}
    if later:
        result.update(last_active=at, last_event=event)
    result["session_count"] = int(previous.get("session_count", 0)) + int(new_session)
    if new_session:
        result["last_session_at"] = at
    return result, int(new_session)


def _eligible(db, uid):
    if is_owner(uid, db):
        return False
    snap = db.document(f"user_status/{uid}").get()
    status = snap.to_dict() if snap.exists else {}
    if status.get("status") != "approved":
        return False
    # QA retains synthetic-user traffic to make its dashboard useful.
    return not (APP_ENV.value == "production" and status.get("is_test"))


def record_usage_event(uid, event, event_id, *, source="server", screen=None, at=None, actions=None):
    """Idempotent server hook; never let a telemetry failure fail a user operation."""
    if event not in DOMAIN_EVENTS and event not in ("screen_view", "heartbeat", "ui_actions"):
        return False
    if (event == "ui_actions" and (screen != "workout" or not valid_ui_actions(actions))) or (event != "ui_actions" and actions is not None):
        return False
    if screen is not None and screen not in SCREENS:
        return False
    if not isinstance(event_id, str) or not event_id or len(event_id) > 250:
        return False
    db = fs.client()
    if not _eligible(db, uid):
        return False
    now = at or _utcnow()
    day = reporting_day(now)
    key = hashlib.sha256(f"{uid}:{event_id}".encode()).hexdigest()
    event_ref = db.document(f"usage_events/{key}")
    user_ref = db.document(f"usage_users/{uid}")
    day_ref = db.document(f"usage_user_days/{day}_{uid}")
    # Existing deployed writers replace the base day document. Keep action
    # counters in a distinct document in the same TTL/cleanup collection.
    action_ref = db.document(f"usage_user_days/actions:{day}:{uid}") if actions else None

    @fs.transactional
    def commit(transaction):
        seen, user_snap, day_snap = (ref.get(transaction=transaction) for ref in (event_ref, user_ref, day_ref))
        action_snap = action_ref.get(transaction=transaction) if action_ref else None
        if seen.exists:
            return False
        previous = user_snap.to_dict() if user_snap.exists else {}
        # Background/replayed client pings must not inflate request volume.
        if event == "heartbeat" and previous.get("last_heartbeat") and now - previous["last_heartbeat"] < timedelta(seconds=30):
            return False
        user, sessions = activity_transition(previous, event, now)
        user["uid"] = uid
        if event == "heartbeat":
            user["last_heartbeat"] = now
        if event == "onboarding_completed" and not user.get("first_onboarded_at"):
            user["first_onboarded_at"] = now
        if event == "workout_completed" and not user.get("first_workout_at"):
            user["first_workout_at"] = now
        current_day = day_snap.to_dict() if day_snap.exists else {}
        counts = dict(current_day.get("events", {}))
        counts[event] = counts.get(event, 0) + 1
        screens = dict(current_day.get("screens", {}))
        action_day = action_snap.to_dict() if action_snap and action_snap.exists else {}
        action_counts = dict(action_day.get("actions", {}))
        for action, count in (actions or {}).items():
            action_counts[action] = action_counts.get(action, 0) + count
        if event == "screen_view" and screen:
            screens[screen] = screens.get(screen, 0) + 1
        transaction.create(event_ref, {"uid": uid, "event": event, "source": source, "screen": screen, "created_at": now, "expires_at": now + timedelta(days=90)})
        transaction.set(user_ref, user)
        transaction.set(day_ref, {"uid": uid, "date": day, "events": counts, "screens": screens, "sessions": current_day.get("sessions", 0) + sessions, "last_active": max(current_day.get("last_active", now), now), "expires_at": now + timedelta(days=397)})
        if action_ref:
            transaction.set(action_ref, {"kind": "ui_actions", "uid": uid, "date": day,
                                        "actions": action_counts, "expires_at": now + timedelta(days=397)})
        return True

    return commit(db.transaction())


def safe_record_usage(uid, event, event_id, **kwargs):
    try:
        return record_usage_event(uid, event, event_id, **kwargs)
    except Exception:
        # No exception repr: some transports put payloads in messages.
        print("Usage metadata could not be recorded.")
        return False


@https_fn.on_call()
def record_usage(req):
    uid = require_approved(req)
    data = req.data or {}
    if set(data) - {"eventId", "event", "screen", "actions"} or data.get("event") not in ("screen_view", "heartbeat", "ui_actions") or data.get("screen") not in SCREENS or not re.fullmatch(r"[a-zA-Z0-9_-]{12,100}", str(data.get("eventId") or "")):
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.INVALID_ARGUMENT, "Invalid activity event.")
    if (data["event"] == "ui_actions" and (data["screen"] != "workout" or not valid_ui_actions(data.get("actions")))) or (data["event"] != "ui_actions" and "actions" in data):
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.INVALID_ARGUMENT, "Invalid activity event.")
    return {"ok": safe_record_usage(uid, data["event"], data["eventId"], source="client", screen=data["screen"], actions=data.get("actions"))}


def retention_d7(users, days, today):
    """Exact-day retention; immature cohorts are excluded, never treated as churn."""
    dates_by_uid = {}
    for day in days:
        dates_by_uid.setdefault(day["uid"], set()).add(day["date"])
    eligible = returned = 0
    oldest_day = (datetime.fromisoformat(today).date() - timedelta(days=396)).isoformat()
    for user in users:
        first = user.get("first_seen")
        if not first:
            continue
        target = (first.astimezone(REPORT_ZONE).date() + timedelta(days=7)).isoformat()
        if target >= today or target < oldest_day:
            continue  # wait until the whole target calendar day has finished
        eligible += 1
        returned += int(target in dates_by_uid.get(user["uid"], set()))
    return {"eligible": eligible, "returned": returned, "rate": round(returned / eligible * 100, 1) if eligible else None}


@https_fn.on_call()
def usage_report(req):
    require_owner(req)
    requested = (req.data or {}).get("days", 28)
    if requested not in (7, 28, 90):
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.INVALID_ARGUMENT, "Choose 7, 28, or 90 days.")
    db = fs.client()
    now = _utcnow()
    today = now.astimezone(REPORT_ZONE).date()
    # 397 days supports mature D7 cohorts while the displayed series is bounded.
    earliest = (today - timedelta(days=396)).isoformat()
    day_docs = [snap.to_dict() for snap in db.collection("usage_user_days").where(filter=FieldFilter("date", ">=", earliest)).stream()]
    action_docs = [day for day in day_docs if day.get("kind") == "ui_actions"]
    day_docs = [day for day in day_docs if day.get("kind") != "ui_actions"]
    user_docs = [{"uid": snap.id, **(snap.to_dict() or {})} for snap in db.collection("usage_users").stream()]
    statuses = {snap.id: snap.to_dict() or {} for snap in db.collection("user_status").stream()}
    owners = {snap.id for snap in db.collection("admins").stream()}
    excluded = owners | {uid for uid, status in statuses.items() if APP_ENV.value == "production" and status.get("is_test")}
    user_docs = [user for user in user_docs if user["uid"] not in excluded]
    day_docs = [day for day in day_docs if day["uid"] not in excluded]
    def since(n):
        return (today - timedelta(days=n - 1)).isoformat()
    active = {str(n): len({day["uid"] for day in day_docs if day["date"] >= since(n)}) for n in (1, 7, 30)}
    shown = [day for day in day_docs if day["date"] >= since(requested)]
    counts, features, actions = Counter(), Counter(), Counter()
    series = []
    for offset in range(requested - 1, -1, -1):
        date = (today - timedelta(days=offset)).isoformat()
        rows = [day for day in shown if day["date"] == date]
        series.append({"date": date, "activeUsers": len({row["uid"] for row in rows}), "sessions": sum(row.get("sessions", 0) for row in rows)})
    for day in shown:
        counts.update(day.get("events", {}))
        features.update(day.get("screens", {}))
    for day in action_docs:
        if day["uid"] not in excluded and day["date"] >= since(requested):
            actions.update({key: value for key, value in day.get("actions", {}).items() if key in UI_ACTIONS})
    people = []
    for user in sorted(user_docs, key=lambda item: item.get("last_active") or datetime.min.replace(tzinfo=timezone.utc), reverse=True):
        status = statuses.get(user["uid"], {})
        user_rows = [day for day in shown if day["uid"] == user["uid"]]
        people.append({"uid": user["uid"], "displayName": status.get("displayName", ""), "email": status.get("email", ""), "lastActive": user["last_active"].isoformat() if user.get("last_active") else None, "lastEvent": user.get("last_event"), "sessions": sum(day.get("sessions", 0) for day in user_rows), "activeDays": len(user_rows)})
    invitations = [snap.to_dict() or {} for snap in db.collection("invitations").stream()]
    # Funnel counts are lifecycle milestones rather than artificial historical conversions.
    cohorts = {kind: {"access": 0, "onboarded": 0, "firstWorkout": 0} for kind in ("request", "invitation", "existing")}
    users_by_uid = {user["uid"]: user for user in user_docs}
    for uid, status in statuses.items():
        if uid in excluded or not (status.get("access_granted_at") or status.get("status") == "approved"):
            continue
        kind = status.get("acquisition") if status.get("acquisition") in cohorts else "existing"
        cohorts[kind]["access"] += 1
        user = users_by_uid.get(uid, {})
        cohorts[kind]["onboarded"] += int(bool(user.get("first_onboarded_at")))
        cohorts[kind]["firstWorkout"] += int(bool(user.get("first_workout_at")))
    return {"timezone": "America/Costa_Rica", "days": requested, "active": active, "sessions": sum(row["sessions"] for row in series), "workouts": counts.get("workout_completed", 0), "aiCalls": counts.get("ai_succeeded", 0) + counts.get("ai_failed", 0), "aiErrors": counts.get("ai_failed", 0), "series": series, "features": dict(features), "actions": dict(actions), "people": people[:100], "cohorts": cohorts, "invitations": {"created": len(invitations), "accepted": sum(inv.get("status") == "accepted" for inv in invitations)}, "retentionD7": retention_d7(user_docs, day_docs, today.isoformat()), "collectedSince": min((user["first_seen"].isoformat() for user in user_docs if user.get("first_seen")), default=None)}


def _event_time(event):
    value = getattr(event, "time", None)
    if isinstance(value, datetime):
        return value
    if value:
        try:
            return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            pass
    return _utcnow()


@firestore_fn.on_document_written(document="users/{uid}/workout_sessions/{sessionId}")
def usage_workout_changed(event):
    if event.data is None:
        return
    before = event.data.before.to_dict() if event.data.before.exists else None
    after = event.data.after.to_dict() if event.data.after.exists else None
    kind = None
    if before is None and after:
        kind = "workout_completed" if after.get("status") == "completed" else "workout_started"
    elif before and after is None:
        kind = "workout_deleted" if before.get("status") == "completed" else "workout_canceled"
    elif before and after and before.get("status") != "completed" and after.get("status") == "completed":
        kind = "workout_completed"
    elif before and after and before.get("status") == after.get("status") == "completed" and before != after:
        kind = "workout_edited"
    if kind:
        safe_record_usage(event.params["uid"], kind, f"workout:{event.id}", at=_event_time(event))


@firestore_fn.on_document_written(document="users/{uid}/profile/data")
def usage_profile_changed(event):
    if event.data is None or not event.data.after.exists:
        return
    before = event.data.before.to_dict() if event.data.before.exists else {}
    after = event.data.after.to_dict() or {}
    if after.get("onboarding_complete") and not before.get("onboarding_complete"):
        safe_record_usage(event.params["uid"], "onboarding_completed", f"onboard:{event.id}", at=_event_time(event))


@firestore_fn.on_document_created(document="users/{uid}/routines/{routineId}")
def usage_routine_created(event):
    safe_record_usage(event.params["uid"], "routine_created", f"routine:{event.id}", at=_event_time(event))


@firestore_fn.on_document_written(document="users/{uid}/logs/{date}")
def usage_checkin_changed(event):
    if event.data is None or not event.data.after.exists:
        return
    before = event.data.before.to_dict() if event.data.before.exists else {}
    after = event.data.after.to_dict() or {}
    # Workout mirroring updates exercise_log/updated_at only: it is not a check-in.
    keys = ("weight_kg", "energy", "notes", "measurements", "body_fat_pct", "food_log")
    if any(before.get(key) != after.get(key) for key in keys):
        safe_record_usage(event.params["uid"], "checkin_saved", f"checkin:{event.id}", at=_event_time(event))


def run_usage_cleanup(db=None):
    db = db or fs.client()
    now = _utcnow()
    # Bounded batches; daily runs drain old metadata without broad user-data deletes.
    for collection in ("usage_events", "usage_user_days"):
        for _ in range(4):
            snapshots = list(db.collection(collection).where(filter=FieldFilter("expires_at", "<", now)).limit(250).stream())
            if not snapshots:
                break
            batch = db.batch()
            for snap in snapshots:
                batch.delete(snap.reference)
            batch.commit()


# QA is operated manually. TTL handles expiry; the operator can invoke the plain
# helper for an explicit bounded cleanup. Production retains its daily schedule.
if not is_qa_deployment_environment():
    @scheduler_fn.on_schedule(schedule="every 24 hours", timezone="America/Costa_Rica")
    def usage_cleanup(_event):
        run_usage_cleanup()
