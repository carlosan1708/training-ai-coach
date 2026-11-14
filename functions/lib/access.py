"""Shared server authorization. No UI flag or client-written role grants access."""
from firebase_admin import firestore as fs
from firebase_functions import https_fn


def require_authenticated(req) -> str:
    if req.auth is None:
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.UNAUTHENTICATED, "Sign in to continue.")
    return req.auth.uid


def is_owner(uid: str, db=None) -> bool:
    return (db or fs.client()).document(f"admins/{uid}").get().exists


def require_owner(req) -> str:
    uid = require_authenticated(req)
    if not is_owner(uid):
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.PERMISSION_DENIED, "Owner access required.")
    return uid


def require_approved(req) -> str:
    uid = require_authenticated(req)
    db = fs.client()
    if is_owner(uid, db):
        return uid
    status = db.document(f"user_status/{uid}").get()
    if not status.exists or (status.to_dict() or {}).get("status") != "approved":
        raise https_fn.HttpsError(https_fn.FunctionsErrorCode.PERMISSION_DENIED, "Your account needs approved access.")
    return uid
