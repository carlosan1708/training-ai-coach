"""Owner invitations and access requests. Tokens are opaque, hashed, and single use."""
import hashlib
import hmac
import re
import secrets
import smtplib
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from urllib.parse import urlparse
from uuid import uuid4

from firebase_admin import firestore as fs
from firebase_functions import https_fn
from firebase_functions.params import SecretParam, StringParam
from lib.access import require_authenticated, require_owner

APP_ENV = StringParam("APP_ENV", default="production")
APP_BASE_URL = StringParam("APP_BASE_URL", default="")
SMTP_USER = SecretParam("SMTP_USER")
SMTP_PASSWORD = SecretParam("SMTP_PASSWORD")
SMTP_HOST = StringParam("SMTP_HOST", default="smtp.gmail.com")
SMTP_PORT = StringParam("SMTP_PORT", default="587")


def _error(code, message):
    raise https_fn.HttpsError(code, message)


def _now():
    return datetime.now(timezone.utc)


def _email(value):
    value = str(value or "").strip().lower()
    if len(value) > 254 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
        _error(https_fn.FunctionsErrorCode.INVALID_ARGUMENT, "Enter a valid email address.")
    return value


def _claims(req):
    token = req.auth.token or {}
    if not token.get("email_verified"):
        _error(https_fn.FunctionsErrorCode.PERMISSION_DENIED, "Use an account with a verified email address.")
    return _email(token.get("email")), str(token.get("name") or token.get("email") or "")[:150]


def _digest(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _new_token(invitation_id):
    return f"{invitation_id}.{secrets.token_urlsafe(32)}"


def _invitation_id(value):
    value = str(value or "")
    if not re.fullmatch(r"[a-f0-9]{32}", value):
        _error(https_fn.FunctionsErrorCode.INVALID_ARGUMENT, "This invitation link is invalid. Ask for a new invitation.")
    return value


def _link(token):
    base = APP_BASE_URL.value.strip().rstrip("/")
    parsed = urlparse(base)
    local = APP_ENV.value in ("qa", "development") and parsed.hostname in ("localhost", "127.0.0.1")
    if not parsed.hostname or (parsed.scheme != "https" and not (local and parsed.scheme == "http")) or parsed.username or parsed.query or parsed.fragment:
        _error(https_fn.FunctionsErrorCode.FAILED_PRECONDITION, "Configure the app URL before creating invitations.")
    # The token stays out of server request URLs and referrers.
    return f"{base}/invite#token={token}"


def _public_invitation(invitation_id, data):
    keys = ("email", "status", "created_at", "expires_at", "accepted_at", "delivery", "created_by")
    result = {key: data[key] for key in keys if key in data}
    for key, value in result.items():
        if isinstance(value, datetime):
            result[key] = value.isoformat()
    if result.get("status") == "pending" and data.get("expires_at") and data["expires_at"] <= _now():
        result["status"] = "expired"
    return {"id": invitation_id, **result}


def _audit(db, action, actor, target=""):
    db.collection("access_audit").add({"action": action, "actor_uid": actor, "target": target, "created_at": fs.SERVER_TIMESTAMP})


def _deliver(db, invitation_id, email, link):
    """QA captures delivery metadata only. Never write the bearer link to a log/outbox."""
    if APP_ENV.value != "production":
        db.collection("qa_mail").add({"invitation_id": invitation_id, "recipient": email, "kind": "invitation", "created_at": fs.SERVER_TIMESTAMP})
        return "captured"
    user, password = SMTP_USER.value, SMTP_PASSWORD.value
    if not user or not password:
        return "not_configured"
    message = EmailMessage()
    message["Subject"] = "You're invited to Training Coach"
    message["From"], message["To"] = user, email
    message.set_content(f"Your personal training space is ready.\n\nOpen your invitation and sign in with this email address:\n{link}\n\nThis private invitation expires in 7 days and can be used once.")
    try:
        with smtplib.SMTP(SMTP_HOST.value, int(SMTP_PORT.value), timeout=15) as server:
            server.starttls()
            server.login(user, password)
            server.send_message(message)
        return "sent"
    except Exception:
        # SMTP exceptions may include recipients or message content. Keep logs token-free.
        return "failed"


@https_fn.on_call()
def request_access(req):
    uid = require_authenticated(req)
    email, name = _claims(req)
    db = fs.client()
    ref = db.document(f"user_status/{uid}")

    @fs.transactional
    def save(transaction):
        existing = ref.get(transaction=transaction)
        if existing.exists:
            return (existing.to_dict() or {}).get("status", "pending")
        transaction.create(ref, {"uid": uid, "email": email, "displayName": name, "status": "pending", "acquisition": "request", "created_at": fs.SERVER_TIMESTAMP, "updated_at": fs.SERVER_TIMESTAMP})
        return "pending"

    return {"status": save(db.transaction())}


@https_fn.on_call()
def list_people(req):
    require_owner(req)
    db = fs.client()
    data = req.data or {}
    page_size = min(100, max(1, int(data.get("limit", 50))))
    people_query = db.collection("user_status").order_by("created_at", direction=fs.Query.DESCENDING)
    cursor = data.get("cursor")
    if cursor:
        previous = db.document(f"user_status/{str(cursor)[:128]}").get()
        if previous.exists:
            people_query = people_query.start_after(previous)
    snapshots = list(people_query.limit(page_size + 1).stream())
    people = []
    for snap in snapshots[:page_size]:
        item = snap.to_dict() or {}
        people.append({"uid": snap.id, **{key: value.isoformat() if isinstance(value, datetime) else value for key, value in item.items() if key in ("email", "displayName", "status", "created_at", "updated_at", "acquisition")}})
    invitations = [_public_invitation(snap.id, snap.to_dict() or {}) for snap in db.collection("invitations").order_by("created_at", direction=fs.Query.DESCENDING).limit(100).stream()]
    return {"people": people, "invitations": invitations, "nextCursor": snapshots[page_size - 1].id if len(snapshots) > page_size else None}


@https_fn.on_call()
def set_access_status(req):
    owner = require_owner(req)
    data = req.data or {}
    uid, status = str(data.get("uid") or ""), data.get("status")
    if not uid or "/" in uid or len(uid) > 128 or status not in ("approved", "rejected"):
        _error(https_fn.FunctionsErrorCode.INVALID_ARGUMENT, "Choose a person and an access status.")
    if uid == owner and status == "rejected":
        _error(https_fn.FunctionsErrorCode.FAILED_PRECONDITION, "The owner cannot reject their own access.")
    db = fs.client()
    ref = db.document(f"user_status/{uid}")

    @fs.transactional
    def save(transaction):
        snap = ref.get(transaction=transaction)
        if not snap.exists:
            _error(https_fn.FunctionsErrorCode.NOT_FOUND, "This access request no longer exists.")
        previous = snap.to_dict() or {}
        changes = {"status": status, "updated_at": fs.SERVER_TIMESTAMP}
        if status == "approved" and not previous.get("access_granted_at"):
            changes["access_granted_at"] = fs.SERVER_TIMESTAMP
        transaction.update(ref, changes)

    save(db.transaction())
    _audit(db, f"access_{status}", owner, uid)
    return {"status": status}


def _issue(req, invitation_id=None):
    owner = require_owner(req)
    db = fs.client()
    data = req.data or {}
    existing = None
    if invitation_id:
        invitation_id = _invitation_id(invitation_id)
        snap = db.document(f"invitations/{invitation_id}").get()
        if not snap.exists:
            _error(https_fn.FunctionsErrorCode.NOT_FOUND, "Invitation not found.")
        existing = snap.to_dict() or {}
        if existing.get("status") == "accepted":
            _error(https_fn.FunctionsErrorCode.FAILED_PRECONDITION, "This invitation has already been accepted.")
        email = existing["email"]
    else:
        invitation_id, email = uuid4().hex, _email(data.get("email"))
    token = _new_token(invitation_id)
    link = _link(token)
    now = _now()
    record = {"email": email, "token_hash": _digest(token), "status": "pending", "created_by": existing.get("created_by", owner) if existing else owner, "created_at": existing.get("created_at", now) if existing else now, "updated_at": now, "expires_at": now + timedelta(days=7), "delivery": "pending"}
    ref = db.document(f"invitations/{invitation_id}")
    # Resend token rotation checks status again under a transaction so acceptance
    # cannot race with a stale resend and resurrect a used invitation.
    @fs.transactional
    def save(transaction):
        current = ref.get(transaction=transaction)
        if current.exists and (current.to_dict() or {}).get("status") == "accepted":
            _error(https_fn.FunctionsErrorCode.FAILED_PRECONDITION, "This invitation has already been accepted.")
        transaction.set(ref, record)
    save(db.transaction())
    delivery = _deliver(db, invitation_id, email, link)
    # Delivery may finish after acceptance; update only the delivery metadata.
    ref.update({"delivery": delivery})
    _audit(db, "invitation_resent" if existing else "invitation_created", owner, invitation_id)
    return {"invitation": _public_invitation(invitation_id, {**record, "delivery": delivery}), "link": link, "delivery": delivery}


@https_fn.on_call(secrets=[SMTP_USER, SMTP_PASSWORD])
def create_invitation(req):
    return _issue(req)


@https_fn.on_call(secrets=[SMTP_USER, SMTP_PASSWORD])
def resend_invitation(req):
    return _issue(req, (req.data or {}).get("invitationId"))


@https_fn.on_call()
def revoke_invitation(req):
    owner = require_owner(req)
    invitation_id = _invitation_id((req.data or {}).get("invitationId"))
    db = fs.client()
    ref = db.document(f"invitations/{invitation_id}")
    @fs.transactional
    def save(transaction):
        snap = ref.get(transaction=transaction)
        if not snap.exists:
            _error(https_fn.FunctionsErrorCode.NOT_FOUND, "Invitation not found.")
        if (snap.to_dict() or {}).get("status") == "accepted":
            _error(https_fn.FunctionsErrorCode.FAILED_PRECONDITION, "Accepted invitations cannot be revoked. Change the person's access instead.")
        transaction.update(ref, {"status": "revoked", "token_hash": "", "updated_at": fs.SERVER_TIMESTAMP})
    save(db.transaction())
    _audit(db, "invitation_revoked", owner, invitation_id)
    return {"ok": True}


def validate_invitation(record, token, email, now):
    if not record or not hmac.compare_digest(str(record.get("token_hash", "")), _digest(token)):
        _error(https_fn.FunctionsErrorCode.NOT_FOUND, "This invitation link is invalid or was replaced. Ask for a new invitation.")
    if record.get("email") != email:
        _error(https_fn.FunctionsErrorCode.PERMISSION_DENIED, "This invitation belongs to a different email. Switch Google accounts and try again.")
    if record.get("status") == "revoked":
        _error(https_fn.FunctionsErrorCode.FAILED_PRECONDITION, "This invitation was revoked. Ask the owner for a new invitation.")
    if record.get("status") == "accepted":
        return
    if record.get("status") != "pending" or not record.get("expires_at") or record["expires_at"] <= now:
        _error(https_fn.FunctionsErrorCode.DEADLINE_EXCEEDED, "This invitation has expired. Ask the owner to resend it.")


@https_fn.on_call()
def accept_invitation(req):
    uid = require_authenticated(req)
    email, name = _claims(req)
    token = str((req.data or {}).get("token") or "")
    if len(token) > 160:
        _error(https_fn.FunctionsErrorCode.INVALID_ARGUMENT, "Invalid invitation.")
    invitation_id = _invitation_id(token.split(".", 1)[0])
    db = fs.client()
    invite_ref, status_ref = db.document(f"invitations/{invitation_id}"), db.document(f"user_status/{uid}")
    @fs.transactional
    def accept(transaction):
        invitation, status = invite_ref.get(transaction=transaction), status_ref.get(transaction=transaction)
        record = invitation.to_dict() if invitation.exists else None
        validate_invitation(record, token, email, _now())
        previous = status.to_dict() if status.exists else {}
        if previous.get("status") == "rejected":
            _error(https_fn.FunctionsErrorCode.PERMISSION_DENIED, "Your access was declined. Contact the owner to restore it.")
        if record.get("status") == "accepted":
            if record.get("accepted_by") != uid:
                _error(https_fn.FunctionsErrorCode.ALREADY_EXISTS, "This invitation has already been used.")
            return
        transaction.update(invite_ref, {"status": "accepted", "accepted_by": uid, "accepted_at": fs.SERVER_TIMESTAMP, "updated_at": fs.SERVER_TIMESTAMP})
        transaction.set(status_ref, {**previous, "uid": uid, "email": email, "displayName": name, "status": "approved", "acquisition": previous.get("acquisition") or "invitation", "invitation_id": invitation_id, "access_granted_at": previous.get("access_granted_at") or fs.SERVER_TIMESTAMP, "created_at": previous.get("created_at") or fs.SERVER_TIMESTAMP, "updated_at": fs.SERVER_TIMESTAMP})
    accept(db.transaction())
    _audit(db, "invitation_accepted", uid, invitation_id)
    return {"status": "approved"}
