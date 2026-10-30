import datetime
import hashlib
import hmac
import os
import secrets

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.db import get_db
from app.models import Board, Session, User, Workspace, WorkspaceMember, now

SESSION_COOKIE = "crm_session"
SESSION_DAYS = int(os.getenv("SESSION_DAYS", "30"))
# En producción (HTTPS) la cookie solo viaja cifrada
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "true").lower() != "false"


def hash_password(password):
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
    return f"scrypt${salt.hex()}${digest.hex()}"


def verify_password(password, stored):
    try:
        _, salt, digest = stored.split("$")
    except ValueError:
        return False
    candidate = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=2**14, r=8, p=1)
    return hmac.compare_digest(candidate.hex(), digest)


def _token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def create_session(db, user):
    token = secrets.token_urlsafe(32)
    db.add(Session(token_hash=_token_hash(token), user_id=user.id,
                   expires_at=now() + datetime.timedelta(days=SESSION_DAYS)))
    db.commit()
    return token


def delete_session(db, token):
    session = db.get(Session, _token_hash(token))
    if session:
        db.delete(session)
        db.commit()


def current_user(request: Request, db: DbSession = Depends(get_db)):
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(401, "No has iniciado sesión")
    session = db.get(Session, _token_hash(token))
    if session is None:
        raise HTTPException(401, "Sesión no válida")
    expires_at = session.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=datetime.timezone.utc)
    if expires_at < now() or not session.user.is_active:
        raise HTTPException(401, "Sesión expirada")
    return session.user


def require_admin(user: User = Depends(current_user)):
    if user.role != "admin":
        raise HTTPException(403, "Solo un administrador puede hacer esto")
    return user


def visible_workspace_ids(db, user):
    if user.role == "admin":
        return set(db.scalars(select(Workspace.id)))
    return set(db.scalars(select(WorkspaceMember.workspace_id).where(WorkspaceMember.user_id == user.id)))


def get_board_for_user(db, user, board_id):
    board = db.get(Board, board_id)
    # 404 y no 403: quien no tiene acceso tampoco debe saber que el tablero existe
    if board is None or board.workspace_id not in visible_workspace_ids(db, user):
        raise HTTPException(404, "Tablero no encontrado")
    return board
