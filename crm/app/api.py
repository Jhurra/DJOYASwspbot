import csv
import io
import time
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session as DbSession

from app.auth import (
    COOKIE_SECURE, SESSION_COOKIE, SESSION_DAYS, create_session, current_user, delete_session,
    get_board_for_user, hash_password, require_admin, verify_password, visible_workspace_ids,
)
from app.db import get_db
from app.models import Board, Column, Folder, Group, Item, Update, User, Workspace, WorkspaceMember
from app.values import COLUMN_TYPES, LABEL_TYPES, normalize_settings, normalize_value, safe_color

router = APIRouter(prefix="/api")


# ---------- Serialización ----------

def user_out(u):
    return {"id": u.id, "email": u.email, "name": u.name, "role": u.role, "is_active": u.is_active}


def column_out(c):
    return {"id": c.id, "key": c.key, "title": c.title, "type": c.type, "settings": c.settings, "position": c.position}


def group_out(g):
    return {"id": g.id, "title": g.title, "color": g.color, "position": g.position}


def item_out(i):
    return {
        "id": i.id, "board_id": i.board_id, "group_id": i.group_id, "parent_item_id": i.parent_item_id,
        "name": i.name, "values": i.values or {}, "position": i.position,
        "created_at": i.created_at.isoformat() if i.created_at else None,
        "updated_at": i.updated_at.isoformat() if i.updated_at else None,
    }


def update_out(u):
    return {"id": u.id, "item_id": u.item_id, "user_id": u.user_id, "author_name": u.author_name,
            "body": u.body, "created_at": u.created_at.isoformat() if u.created_at else None}


def board_summary_out(b):
    return {"id": b.id, "name": b.name, "item_label": b.item_label, "folder_id": b.folder_id, "position": b.position}


def columns_of(db, board_id):
    return list(db.scalars(select(Column).where(Column.board_id == board_id).order_by(Column.position, Column.id)))


def next_position(db, model, **filters):
    query = select(func.max(model.position))
    for field, value in filters.items():
        query = query.where(getattr(model, field) == value)
    return (db.scalar(query) or 0) + 1


# ---------- Autenticación ----------

class LoginIn(BaseModel):
    email: str
    password: str


# Freno simple a ataques de fuerza bruta: 10 intentos fallidos por email cada 15 minutos
_failed_logins = defaultdict(list)
MAX_FAILED, FAILED_WINDOW = 10, 15 * 60


@router.post("/auth/login")
def login(data: LoginIn, response: Response, db: DbSession = Depends(get_db)):
    email = data.email.strip().lower()
    attempts = [t for t in _failed_logins[email] if time.time() - t < FAILED_WINDOW]
    _failed_logins[email] = attempts
    if len(attempts) >= MAX_FAILED:
        raise HTTPException(429, "Demasiados intentos. Espera unos minutos.")
    user = db.scalar(select(User).where(User.email == email))
    if user is None or not user.is_active or not verify_password(data.password, user.password_hash):
        attempts.append(time.time())
        raise HTTPException(401, "Email o contraseña incorrectos")
    _failed_logins.pop(email, None)
    token = create_session(db, user)
    response.set_cookie(SESSION_COOKIE, token, max_age=SESSION_DAYS * 86400, httponly=True,
                        secure=COOKIE_SECURE, samesite="lax")
    return user_out(user)


@router.post("/auth/logout")
def logout(request: Request, response: Response, db: DbSession = Depends(get_db)):
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        delete_session(db, token)
    response.delete_cookie(SESSION_COOKIE)
    return {"ok": True}


@router.get("/me")
def me(user: User = Depends(current_user)):
    return user_out(user)


# ---------- Espacios de trabajo y carpetas ----------

@router.get("/workspaces")
def list_workspaces(user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    ids = visible_workspace_ids(db, user)
    workspaces = db.scalars(select(Workspace).where(Workspace.id.in_(ids)).order_by(Workspace.position, Workspace.id))
    folders = db.scalars(select(Folder).where(Folder.workspace_id.in_(ids)).order_by(Folder.position, Folder.id))
    boards = db.scalars(select(Board).where(Board.workspace_id.in_(ids), Board.kind == "main")
                        .order_by(Board.position, Board.id))
    tree = {w.id: {"id": w.id, "name": w.name, "description": w.description, "folders": [], "boards": []}
            for w in workspaces}
    folder_map = {}
    for f in folders:
        folder_map[f.id] = {"id": f.id, "name": f.name, "boards": []}
        tree[f.workspace_id]["folders"].append(folder_map[f.id])
    for b in boards:
        target = folder_map.get(b.folder_id) or tree[b.workspace_id]
        target["boards"].append(board_summary_out(b))
    return list(tree.values())


class WorkspaceIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str = ""


class WorkspacePatch(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = None


@router.post("/workspaces")
def create_workspace(data: WorkspaceIn, admin: User = Depends(require_admin), db: DbSession = Depends(get_db)):
    ws = Workspace(name=data.name, description=data.description, position=next_position(db, Workspace))
    db.add(ws)
    db.flush()
    db.add(WorkspaceMember(workspace_id=ws.id, user_id=admin.id))
    db.commit()
    return {"id": ws.id, "name": ws.name, "description": ws.description}


@router.patch("/workspaces/{workspace_id}")
def update_workspace(workspace_id: int, data: WorkspacePatch, admin: User = Depends(require_admin),
                     db: DbSession = Depends(get_db)):
    ws = db.get(Workspace, workspace_id) or _not_found("Espacio de trabajo")
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(ws, field, value)
    db.commit()
    return {"id": ws.id, "name": ws.name, "description": ws.description}


@router.delete("/workspaces/{workspace_id}")
def delete_workspace(workspace_id: int, admin: User = Depends(require_admin), db: DbSession = Depends(get_db)):
    ws = db.get(Workspace, workspace_id) or _not_found("Espacio de trabajo")
    if db.scalar(select(func.count()).select_from(Board).where(Board.workspace_id == ws.id)):
        raise HTTPException(409, "Mueve o elimina sus tableros antes de borrar el espacio de trabajo")
    db.delete(ws)
    db.commit()
    return {"ok": True}


@router.get("/workspaces/{workspace_id}/members")
def workspace_members(workspace_id: int, admin: User = Depends(require_admin), db: DbSession = Depends(get_db)):
    db.get(Workspace, workspace_id) or _not_found("Espacio de trabajo")
    return list(db.scalars(select(WorkspaceMember.user_id).where(WorkspaceMember.workspace_id == workspace_id)))


class MembersIn(BaseModel):
    user_ids: list[int]


@router.put("/workspaces/{workspace_id}/members")
def set_workspace_members(workspace_id: int, data: MembersIn, admin: User = Depends(require_admin),
                          db: DbSession = Depends(get_db)):
    db.get(Workspace, workspace_id) or _not_found("Espacio de trabajo")
    db.execute(delete(WorkspaceMember).where(WorkspaceMember.workspace_id == workspace_id))
    for user_id in set(data.user_ids):
        if db.get(User, user_id):
            db.add(WorkspaceMember(workspace_id=workspace_id, user_id=user_id))
    db.commit()
    return {"ok": True}


class FolderIn(BaseModel):
    workspace_id: int
    name: str = Field(min_length=1, max_length=255)


class FolderPatch(BaseModel):
    name: str = Field(min_length=1, max_length=255)


@router.post("/folders")
def create_folder(data: FolderIn, admin: User = Depends(require_admin), db: DbSession = Depends(get_db)):
    db.get(Workspace, data.workspace_id) or _not_found("Espacio de trabajo")
    folder = Folder(workspace_id=data.workspace_id, name=data.name,
                    position=next_position(db, Folder, workspace_id=data.workspace_id))
    db.add(folder)
    db.commit()
    return {"id": folder.id, "name": folder.name}


@router.patch("/folders/{folder_id}")
def rename_folder(folder_id: int, data: FolderPatch, admin: User = Depends(require_admin),
                  db: DbSession = Depends(get_db)):
    folder = db.get(Folder, folder_id) or _not_found("Carpeta")
    folder.name = data.name
    db.commit()
    return {"id": folder.id, "name": folder.name}


@router.delete("/folders/{folder_id}")
def delete_folder(folder_id: int, admin: User = Depends(require_admin), db: DbSession = Depends(get_db)):
    folder = db.get(Folder, folder_id) or _not_found("Carpeta")
    # Los tableros no se borran: quedan sueltos en el espacio de trabajo
    for board in db.scalars(select(Board).where(Board.folder_id == folder.id)):
        board.folder_id = None
    db.delete(folder)
    db.commit()
    return {"ok": True}


# ---------- Tableros ----------

class BoardIn(BaseModel):
    workspace_id: int
    folder_id: int | None = None
    name: str = Field(min_length=1, max_length=255)
    item_label: str = "Elemento"
    description: str = ""


class BoardPatch(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=255)
    item_label: str | None = None
    description: str | None = None
    workspace_id: int | None = None
    folder_id: int | None = None


def _check_folder(db, folder_id, workspace_id):
    if folder_id is not None:
        folder = db.get(Folder, folder_id)
        if folder is None or folder.workspace_id != workspace_id:
            raise HTTPException(400, "La carpeta no pertenece a ese espacio de trabajo")


@router.post("/boards")
def create_board(data: BoardIn, admin: User = Depends(require_admin), db: DbSession = Depends(get_db)):
    db.get(Workspace, data.workspace_id) or _not_found("Espacio de trabajo")
    _check_folder(db, data.folder_id, data.workspace_id)
    board = Board(workspace_id=data.workspace_id, folder_id=data.folder_id, name=data.name,
                  item_label=data.item_label or "Elemento", description=data.description,
                  position=next_position(db, Board, workspace_id=data.workspace_id))
    db.add(board)
    db.flush()
    db.add(Group(board_id=board.id, title="Nuevos", color="#579bfc", position=1))
    db.add(Column(board_id=board.id, key="estado", title="Estado", type="status", position=1, settings={"labels": [
        {"id": "0", "label": "Pendiente", "color": "#c4c4c4", "done": False},
        {"id": "1", "label": "En curso", "color": "#fdab3d", "done": False},
        {"id": "2", "label": "Listo", "color": "#00c875", "done": True},
    ]}))
    db.commit()
    return board_summary_out(board)


@router.get("/boards/{board_id}")
def get_board(board_id: int, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    board = get_board_for_user(db, user, board_id)
    groups = db.scalars(select(Group).where(Group.board_id == board.id).order_by(Group.position, Group.id))
    sub = db.get(Board, board.subitems_board_id) if board.subitems_board_id else None
    workspace = db.get(Workspace, board.workspace_id)
    return {
        **board_summary_out(board),
        "description": board.description,
        "workspace": {"id": workspace.id, "name": workspace.name},
        "columns": [column_out(c) for c in columns_of(db, board.id)],
        "groups": [group_out(g) for g in groups],
        "subitems_board": {"id": sub.id, "columns": [column_out(c) for c in columns_of(db, sub.id)]} if sub else None,
    }


@router.patch("/boards/{board_id}")
def update_board(board_id: int, data: BoardPatch, admin: User = Depends(require_admin),
                 db: DbSession = Depends(get_db)):
    board = db.get(Board, board_id) or _not_found("Tablero")
    fields = data.model_dump(exclude_unset=True)
    workspace_id = fields.get("workspace_id") or board.workspace_id
    if "workspace_id" in fields:
        db.get(Workspace, workspace_id) or _not_found("Espacio de trabajo")
        if "folder_id" not in fields:
            fields["folder_id"] = None
    if "folder_id" in fields:
        _check_folder(db, fields["folder_id"], workspace_id)
    for field, value in fields.items():
        if value is not None or field == "folder_id":
            setattr(board, field, value)
    # El tablero de subelementos acompaña al principal
    if board.subitems_board_id:
        db.get(Board, board.subitems_board_id).workspace_id = board.workspace_id
    db.commit()
    return board_summary_out(board)


@router.delete("/boards/{board_id}")
def delete_board(board_id: int, admin: User = Depends(require_admin), db: DbSession = Depends(get_db)):
    board = db.get(Board, board_id) or _not_found("Tablero")
    if board.subitems_board_id:
        db.delete(db.get(Board, board.subitems_board_id))
    db.delete(board)
    db.commit()
    return {"ok": True}


def _related_names(db, user, columns, items):
    ids = set()
    for column in columns:
        if column.type == "relation":
            for item in items:
                ids.update((item.values or {}).get(column.key) or [])
    if not ids:
        return {}
    visible = visible_workspace_ids(db, user)
    rows = db.execute(select(Item.id, Item.name).join(Board, Board.id == Item.board_id)
                      .where(Item.id.in_(ids), Board.workspace_id.in_(visible)))
    return {str(row.id): row.name for row in rows}


@router.get("/boards/{board_id}/items")
def list_items(board_id: int, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    board = get_board_for_user(db, user, board_id)
    items = list(db.scalars(select(Item).where(Item.board_id == board.id, Item.parent_item_id.is_(None))
                            .order_by(Item.position, Item.id)))
    subitem_counts = {}
    if board.subitems_board_id:
        rows = db.execute(select(Item.parent_item_id, func.count()).where(Item.board_id == board.subitems_board_id)
                          .group_by(Item.parent_item_id))
        subitem_counts = {str(parent): count for parent, count in rows}
    return {
        "items": [item_out(i) for i in items],
        "related": _related_names(db, user, columns_of(db, board.id), items),
        "subitem_counts": subitem_counts,
    }


def _cell_text(column, value, related):
    if value is None:
        return ""
    labels = {str(l["id"]): l["label"] for l in column.settings.get("labels", [])}
    if column.type == "status":
        return labels.get(value, "")
    if column.type == "dropdown":
        return ", ".join(labels.get(v, "") for v in value)
    if column.type == "timeline":
        return f"{value.get('from') or ''} - {value.get('to') or ''}"
    if column.type == "link":
        return value.get("url", "")
    if column.type == "people":
        return ", ".join(value)
    if column.type == "relation":
        return ", ".join(related.get(str(v), "") for v in value)
    if column.type == "file":
        return ", ".join(f["url"] for f in value)
    if column.type == "checkbox":
        return "Sí" if value else ""
    return str(value)


@router.get("/boards/{board_id}/export.csv")
def export_csv(board_id: int, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    board = get_board_for_user(db, user, board_id)
    columns = columns_of(db, board.id)
    groups = {g.id: g.title for g in db.scalars(select(Group).where(Group.board_id == board.id))}
    items = list(db.scalars(select(Item).where(Item.board_id == board.id, Item.parent_item_id.is_(None))
                            .order_by(Item.position, Item.id)))
    related = _related_names(db, user, columns, items)
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["Nombre", "Grupo"] + [c.title for c in columns])
    for item in items:
        writer.writerow([item.name, groups.get(item.group_id, "")] +
                        [_cell_text(c, (item.values or {}).get(c.key), related) for c in columns])
    filename = "".join(ch for ch in board.name if ch.isalnum() or ch in " -_").strip() or "tablero"
    # BOM para que Excel abra bien los acentos
    return Response("﻿" + out.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{filename}.csv"'})


# ---------- Columnas ----------

class ColumnIn(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    type: str
    settings: dict = {}


class ColumnPatch(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=255)
    settings: dict | None = None
    position: float | None = None


@router.post("/boards/{board_id}/columns")
def create_column(board_id: int, data: ColumnIn, admin: User = Depends(require_admin),
                  db: DbSession = Depends(get_db)):
    board = db.get(Board, board_id) or _not_found("Tablero")
    if data.type not in COLUMN_TYPES:
        raise HTTPException(400, "Tipo de columna no válido")
    existing = {c.key for c in columns_of(db, board.id)}
    n = len(existing) + 1
    while f"col_{n}" in existing:
        n += 1
    column = Column(board_id=board.id, key=f"col_{n}", title=data.title, type=data.type,
                    settings=normalize_settings(data.type, data.settings),
                    position=next_position(db, Column, board_id=board.id))
    db.add(column)
    db.commit()
    return column_out(column)


def _clean_orphan_labels(db, column):
    """Si se borró una etiqueta, quita ese valor de los elementos que la tenían."""
    valid = {str(l["id"]) for l in column.settings.get("labels", [])}
    for item in db.scalars(select(Item).where(Item.board_id == column.board_id)):
        value = (item.values or {}).get(column.key)
        if value is None:
            continue
        if column.type == "status" and value not in valid:
            new_value = None
        elif column.type == "dropdown":
            new_value = [v for v in value if v in valid] or None
        else:
            continue
        if new_value != value:
            values = dict(item.values)
            if new_value is None:
                values.pop(column.key, None)
            else:
                values[column.key] = new_value
            item.values = values


@router.patch("/columns/{column_id}")
def update_column(column_id: int, data: ColumnPatch, admin: User = Depends(require_admin),
                  db: DbSession = Depends(get_db)):
    column = db.get(Column, column_id) or _not_found("Columna")
    if data.title is not None:
        column.title = data.title
    if data.position is not None:
        column.position = data.position
    if data.settings is not None:
        column.settings = normalize_settings(column.type, data.settings)
        if column.type in LABEL_TYPES:
            _clean_orphan_labels(db, column)
    db.commit()
    return column_out(column)


@router.delete("/columns/{column_id}")
def delete_column(column_id: int, admin: User = Depends(require_admin), db: DbSession = Depends(get_db)):
    column = db.get(Column, column_id) or _not_found("Columna")
    for item in db.scalars(select(Item).where(Item.board_id == column.board_id)):
        if column.key in (item.values or {}):
            values = dict(item.values)
            values.pop(column.key)
            item.values = values
    db.delete(column)
    db.commit()
    return {"ok": True}


# ---------- Grupos ----------

class GroupIn(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    color: str = "#579bfc"


class GroupPatch(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=255)
    color: str | None = None
    position: float | None = None


@router.post("/boards/{board_id}/groups")
def create_group(board_id: int, data: GroupIn, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    board = get_board_for_user(db, user, board_id)
    # Los grupos nuevos aparecen arriba, como en Monday
    first = db.scalar(select(func.min(Group.position)).where(Group.board_id == board.id)) or 1
    group = Group(board_id=board.id, title=data.title, color=safe_color(data.color, "#579bfc"), position=first - 1)
    db.add(group)
    db.commit()
    return group_out(group)


def _group_for_user(db, user, group_id):
    group = db.get(Group, group_id) or _not_found("Grupo")
    get_board_for_user(db, user, group.board_id)
    return group


@router.patch("/groups/{group_id}")
def update_group(group_id: int, data: GroupPatch, user: User = Depends(current_user),
                 db: DbSession = Depends(get_db)):
    group = _group_for_user(db, user, group_id)
    if data.title is not None:
        group.title = data.title
    if data.color is not None:
        group.color = safe_color(data.color, group.color)
    if data.position is not None:
        group.position = data.position
    db.commit()
    return group_out(group)


@router.delete("/groups/{group_id}")
def delete_group(group_id: int, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    group = _group_for_user(db, user, group_id)
    if db.scalar(select(func.count()).select_from(Item).where(Item.group_id == group.id)):
        raise HTTPException(409, "El grupo tiene elementos. Muévelos o bórralos primero.")
    db.delete(group)
    db.commit()
    return {"ok": True}


# ---------- Elementos ----------

class ItemIn(BaseModel):
    name: str = Field(min_length=1, max_length=500)
    group_id: int | None = None
    values: dict = {}


class ItemPatch(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=500)
    group_id: int | None = None
    position: float | None = None
    values: dict | None = None


def _apply_values(db, board_id, item, changes):
    columns = {c.key: c for c in columns_of(db, board_id)}
    values = dict(item.values or {})
    for key, raw in changes.items():
        column = columns.get(key)
        if column is None:
            raise HTTPException(400, f"Columna inexistente: {key}")
        try:
            value = normalize_value(column, raw)
        except (ValueError, TypeError, AttributeError) as e:
            raise HTTPException(400, f"{column.title}: {e}")
        if value is None:
            values.pop(key, None)
        else:
            values[key] = value
    item.values = values


def _check_group(db, group_id, board_id):
    if group_id is not None:
        group = db.get(Group, group_id)
        if group is None or group.board_id != board_id:
            raise HTTPException(400, "El grupo no pertenece al tablero")


def _item_for_user(db, user, item_id):
    item = db.get(Item, item_id) or _not_found("Elemento")
    get_board_for_user(db, user, item.board_id)
    return item


@router.post("/boards/{board_id}/items")
def create_item(board_id: int, data: ItemIn, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    board = get_board_for_user(db, user, board_id)
    if board.kind != "main":
        raise HTTPException(400, "Usa /items/{id}/subitems para crear subelementos")
    group_id = data.group_id
    if group_id is None:
        group_id = db.scalar(select(Group.id).where(Group.board_id == board.id).order_by(Group.position).limit(1))
    _check_group(db, group_id, board.id)
    first = db.scalar(select(func.min(Item.position)).where(Item.group_id == group_id)) or 1
    item = Item(board_id=board.id, group_id=group_id, name=data.name, values={}, position=first - 1)
    _apply_values(db, board.id, item, data.values)
    db.add(item)
    db.commit()
    return item_out(item)


@router.get("/items/{item_id}")
def get_item(item_id: int, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    item = _item_for_user(db, user, item_id)
    board = db.get(Board, item.board_id)
    subitems = []
    if board.subitems_board_id:
        subitems = db.scalars(select(Item).where(Item.parent_item_id == item.id).order_by(Item.position, Item.id))
    updates = db.scalars(select(Update).where(Update.item_id == item.id).order_by(Update.created_at.desc()))
    return {
        "item": item_out(item),
        "subitems": [item_out(s) for s in subitems],
        "updates": [update_out(u) for u in updates],
        "related": _related_names(db, user, columns_of(db, board.id), [item]),
    }


@router.patch("/items/{item_id}")
def update_item(item_id: int, data: ItemPatch, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    item = _item_for_user(db, user, item_id)
    fields = data.model_dump(exclude_unset=True)
    if "name" in fields and data.name is not None:
        item.name = data.name
    if "group_id" in fields and item.parent_item_id is None:
        _check_group(db, data.group_id, item.board_id)
        item.group_id = data.group_id
    if data.position is not None:
        item.position = data.position
    if data.values:
        _apply_values(db, item.board_id, item, data.values)
    db.commit()
    return item_out(item)


@router.delete("/items/{item_id}")
def delete_item(item_id: int, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    item = _item_for_user(db, user, item_id)
    db.execute(delete(Item).where(Item.parent_item_id == item.id))
    db.delete(item)
    db.commit()
    return {"ok": True}


class SubitemIn(BaseModel):
    name: str = Field(min_length=1, max_length=500)
    values: dict = {}


@router.post("/items/{item_id}/subitems")
def create_subitem(item_id: int, data: SubitemIn, user: User = Depends(current_user),
                   db: DbSession = Depends(get_db)):
    parent = _item_for_user(db, user, item_id)
    board = db.get(Board, parent.board_id)
    if board.kind != "main":
        raise HTTPException(400, "Los subelementos no pueden tener subelementos")
    if not board.subitems_board_id:
        sub = Board(workspace_id=board.workspace_id, name=f"Subelementos de {board.name}", kind="subitems")
        db.add(sub)
        db.flush()
        db.add(Column(board_id=sub.id, key="estado", title="Estado", type="status", position=1, settings={"labels": [
            {"id": "0", "label": "En curso", "color": "#fdab3d", "done": False},
            {"id": "1", "label": "Listo", "color": "#00c875", "done": True},
            {"id": "2", "label": "Detenido", "color": "#df2f4a", "done": False},
        ]}))
        db.add(Column(board_id=sub.id, key="fecha", title="Fecha", type="date", position=2))
        board.subitems_board_id = sub.id
        db.flush()
    subitem = Item(board_id=board.subitems_board_id, parent_item_id=parent.id, name=data.name, values={},
                   position=next_position(db, Item, parent_item_id=parent.id))
    _apply_values(db, board.subitems_board_id, subitem, data.values)
    db.add(subitem)
    db.commit()
    return item_out(subitem)


class UpdateIn(BaseModel):
    body: str = Field(min_length=1, max_length=20000)


@router.post("/items/{item_id}/updates")
def create_update(item_id: int, data: UpdateIn, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    item = _item_for_user(db, user, item_id)
    update = Update(item_id=item.id, user_id=user.id, author_name=user.name, body=data.body.strip())
    db.add(update)
    db.commit()
    return update_out(update)


@router.delete("/updates/{update_id}")
def delete_update(update_id: int, user: User = Depends(current_user), db: DbSession = Depends(get_db)):
    update = db.get(Update, update_id) or _not_found("Comentario")
    _item_for_user(db, user, update.item_id)
    if update.user_id != user.id and user.role != "admin":
        raise HTTPException(403, "Solo puedes borrar tus propios comentarios")
    db.delete(update)
    db.commit()
    return {"ok": True}


# ---------- Usuarios ----------

class UserIn(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    name: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=8, max_length=200)
    role: str = "member"
    workspace_ids: list[int] = []


class UserPatch(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=255)
    role: str | None = None
    is_active: bool | None = None
    password: str | None = Field(None, min_length=8, max_length=200)
    workspace_ids: list[int] | None = None


def _set_user_workspaces(db, user_id, workspace_ids):
    db.execute(delete(WorkspaceMember).where(WorkspaceMember.user_id == user_id))
    for ws_id in set(workspace_ids):
        if db.get(Workspace, ws_id):
            db.add(WorkspaceMember(workspace_id=ws_id, user_id=user_id))


def _user_with_workspaces(db, u):
    ws = db.scalars(select(WorkspaceMember.workspace_id).where(WorkspaceMember.user_id == u.id))
    return {**user_out(u), "workspace_ids": list(ws)}


@router.get("/users")
def list_users(admin: User = Depends(require_admin), db: DbSession = Depends(get_db)):
    return [_user_with_workspaces(db, u) for u in db.scalars(select(User).order_by(User.id))]


@router.post("/users")
def create_user(data: UserIn, admin: User = Depends(require_admin), db: DbSession = Depends(get_db)):
    if data.role not in ("admin", "member"):
        raise HTTPException(400, "Rol no válido")
    email = data.email.strip().lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(409, "Ya existe un usuario con ese email")
    user = User(email=email, name=data.name, password_hash=hash_password(data.password), role=data.role)
    db.add(user)
    db.flush()
    _set_user_workspaces(db, user.id, data.workspace_ids)
    db.commit()
    return _user_with_workspaces(db, user)


@router.patch("/users/{user_id}")
def update_user(user_id: int, data: UserPatch, admin: User = Depends(require_admin), db: DbSession = Depends(get_db)):
    user = db.get(User, user_id) or _not_found("Usuario")
    if user.id == admin.id and (data.role == "member" or data.is_active is False):
        raise HTTPException(400, "No puedes quitarte el rol de administrador ni desactivarte")
    if data.role is not None:
        if data.role not in ("admin", "member"):
            raise HTTPException(400, "Rol no válido")
        user.role = data.role
    if data.name is not None:
        user.name = data.name
    if data.is_active is not None:
        user.is_active = data.is_active
    if data.password:
        user.password_hash = hash_password(data.password)
    if data.workspace_ids is not None:
        _set_user_workspaces(db, user.id, data.workspace_ids)
    db.commit()
    return _user_with_workspaces(db, user)


def _not_found(what):
    raise HTTPException(404, f"{what} no encontrado")
