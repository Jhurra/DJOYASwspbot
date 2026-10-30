"""Importa espacios de trabajo, carpetas, tableros, grupos, elementos, subelementos y comentarios desde Monday.

Se puede correr varias veces: lo que ya se importó se actualiza (se reconoce por monday_id),
así puedes importar ahora, seguir usando Monday unos días y volver a importar antes de cancelar.
"""
import datetime
import json
import logging
import os
import time

import httpx
from sqlalchemy import select

from app.models import Board, Column, Folder, Group, Item, Update, User, Workspace, WorkspaceMember, now
from app.values import safe_color

API_URL = "https://api.monday.com/v2"

# Tipo de Monday -> tipo propio. Lo que no está aquí se importa como texto (con el texto que muestra Monday).
TYPE_MAP = {
    "text": "text", "long_text": "long_text", "numbers": "number", "status": "status", "color": "status",
    "dropdown": "dropdown", "date": "date", "timeline": "timeline", "timerange": "timeline", "email": "email",
    "phone": "phone", "link": "link", "checkbox": "checkbox", "people": "people", "multiple-person": "people",
    "board_relation": "relation", "board-relation": "relation", "file": "file",
}
SKIP_TYPES = {"name", "subtasks", "subitems", "button", "doc"}

COLUMN_FIELDS = "id title type settings_str"
VALUE_FIELDS = "id type text value ... on BoardRelationValue { linked_item_ids }"


class MondayClient:
    def __init__(self, token, api_version=None):
        headers = {"Authorization": token, "Content-Type": "application/json"}
        api_version = api_version or os.getenv("MONDAY_API_VERSION")
        if api_version:
            headers["API-Version"] = api_version
        self.http = httpx.Client(headers=headers, timeout=60)

    def query(self, query, variables=None):
        for attempt in range(6):
            response = self.http.post(API_URL, json={"query": query, "variables": variables or {}})
            if response.status_code == 429 or response.status_code >= 500:
                time.sleep(min(60, 5 * (attempt + 1)))
                continue
            response.raise_for_status()
            data = response.json()
            errors = data.get("errors") or []
            # Monday limita la "complejidad" por minuto; si se excede, hay que esperar
            if any("complexity" in json.dumps(e).lower() or "rate" in json.dumps(e).lower() for e in errors):
                time.sleep(min(60, 10 * (attempt + 1)))
                continue
            if errors:
                raise RuntimeError(f"Error de la API de Monday: {errors}")
            return data["data"]
        raise RuntimeError("La API de Monday no respondió después de varios intentos")

    def workspaces(self, ids=None):
        if ids:
            data = self.query("query ($ids: [ID!]) { workspaces(ids: $ids) { id name description } }", {"ids": ids})
            return data["workspaces"]
        result, page = [], 1
        while True:
            data = self.query("query ($page: Int!) { workspaces(limit: 100, page: $page) { id name description } }",
                              {"page": page})
            result += data["workspaces"]
            if len(data["workspaces"]) < 100:
                return result
            page += 1

    def folders(self, workspace_ids):
        data = self.query("query ($ids: [ID]) { folders(workspace_ids: $ids, limit: 100) { id name workspace { id } } }",
                          {"ids": workspace_ids})
        return data["folders"]

    def boards(self, workspace_ids):
        result, page = [], 1
        while True:
            data = self.query(
                "query ($ids: [ID], $page: Int!) { boards(workspace_ids: $ids, state: active, limit: 50, page: $page) "
                "{ id name description type workspace_id board_folder_id item_terminology "
                f"columns {{ {COLUMN_FIELDS} }} groups {{ id title color position }} }} }}",
                {"ids": workspace_ids, "page": page})
            result += data["boards"]
            if len(data["boards"]) < 50:
                return result
            page += 1

    def board_columns(self, board_id):
        data = self.query(f"query ($ids: [ID!]) {{ boards(ids: $ids) {{ id columns {{ {COLUMN_FIELDS} }} }} }}",
                          {"ids": [board_id]})
        return data["boards"][0]["columns"] if data["boards"] else []

    def items(self, board_id, with_updates=False):
        updates = " updates(limit: 100) { id text_body created_at creator { name email } }" if with_updates else ""
        fields = (f"id name created_at updated_at group {{ id }} column_values {{ {VALUE_FIELDS} }}{updates} "
                  f"subitems {{ id name created_at column_values {{ {VALUE_FIELDS} }}{updates} }}")
        limit = 25 if with_updates else 100
        data = self.query(
            f"query ($ids: [ID!]) {{ boards(ids: $ids) {{ items_page(limit: {limit}) {{ cursor items {{ {fields} }} }} }} }}",
            {"ids": [board_id]})
        page = data["boards"][0]["items_page"]
        while True:
            yield from page["items"]
            if not page["cursor"]:
                return
            data = self.query(
                f"query ($cursor: String!) {{ next_items_page(cursor: $cursor, limit: {limit}) "
                f"{{ cursor items {{ {fields} }} }} }}",
                {"cursor": page["cursor"]})
            page = data["next_items_page"]


# ---------- Conversión de columnas ----------

def convert_settings(column_type, monday_type, settings_str):
    try:
        raw = json.loads(settings_str or "{}")
    except ValueError:
        raw = {}
    if column_type == "status":
        labels = raw.get("labels") or {}
        if isinstance(labels, list):  # formato nuevo de la API
            labels = {str(l.get("id", l.get("index"))): l.get("label") or l.get("name") for l in labels}
        colors = raw.get("labels_colors") or {}
        positions = raw.get("labels_positions_v2") or {}
        deactivated = {str(x) for x in raw.get("deactivated_labels") or []}
        done = {str(x) for x in raw.get("done_colors") or []}
        result = []
        for label_id, name in labels.items():
            if not name or label_id in deactivated:
                continue
            result.append({
                "id": str(label_id), "label": name,
                "color": safe_color((colors.get(label_id) or {}).get("color")),
                "done": label_id in done,
                "_pos": positions.get(label_id, 999),
            })
        result.sort(key=lambda l: (l["_pos"], int(l["id"]) if l["id"].isdigit() else 0))
        for label in result:
            label.pop("_pos")
        return {"labels": result}
    if column_type == "dropdown":
        deactivated = {str(x) for x in raw.get("deactivated_labels") or []}
        labels = []
        for l in raw.get("labels") or []:
            name = l.get("name") or l.get("label")
            if not name or str(l.get("id")) in deactivated:
                continue
            labels.append({"id": str(l["id"]), "label": name, "color": "#c4c4c4", "done": False})
        return {"labels": labels}
    if column_type == "number":
        unit = raw.get("unit") or {}
        return {"unit": unit.get("symbol") or unit.get("custom_unit") or "", "unit_direction": unit.get("direction") or "left"}
    if monday_type in ("board_relation", "board-relation"):
        return {"monday_board_ids": [str(b) for b in raw.get("boardIds") or []]}
    return {}


def _parse(value):
    if not value:
        return None
    try:
        return json.loads(value)
    except ValueError:
        return None


def convert_value(column, cv):
    """Convierte un column_value de Monday al formato propio (ver app/values.py)."""
    t, text, raw = column.type, (cv.get("text") or "").strip(), _parse(cv.get("value"))
    if t in ("text", "long_text"):
        if isinstance(raw, dict) and raw.get("text"):
            return raw["text"]
        return text or None
    if t == "number":
        try:
            n = float(text.replace(",", "")) if text else None
        except ValueError:
            return None
        return None if n is None else (int(n) if n.is_integer() else n)
    if t == "status":
        labels = column.settings.get("labels", [])
        if isinstance(raw, dict) and raw.get("index") is not None:
            label_id = str(raw["index"])
            if any(l["id"] == label_id for l in labels):
                return label_id
        return next((l["id"] for l in labels if l["label"] == text), None) if text else None
    if t == "dropdown":
        labels = column.settings.get("labels", [])
        valid = {l["id"] for l in labels}
        if isinstance(raw, dict) and raw.get("ids"):
            ids = [str(i) for i in raw["ids"] if str(i) in valid]
        else:
            first_id = {}
            for l in labels:
                first_id.setdefault(l["label"], l["id"])
            ids = [first_id[n.strip()] for n in text.split(",") if n.strip() in first_id]
        return list(dict.fromkeys(ids)) or None
    if t == "date":
        if isinstance(raw, dict) and raw.get("date"):
            return raw["date"]
        return text[:10] or None
    if t == "timeline":
        if isinstance(raw, dict) and (raw.get("from") or raw.get("to")):
            return {"from": raw.get("from"), "to": raw.get("to")}
        if " - " in text:
            start, end = text.split(" - ", 1)
            return {"from": start.strip(), "to": end.strip()}
        return None
    if t == "email":
        if isinstance(raw, dict) and raw.get("email"):
            return raw["email"]
        return text or None
    if t == "phone":
        if isinstance(raw, dict) and raw.get("phone"):
            return raw["phone"]
        return text or None
    if t == "link":
        if isinstance(raw, dict) and raw.get("url"):
            return {"url": raw["url"], "text": raw.get("text") or ""}
        if " - http" in text:
            label, url = text.rsplit(" - ", 1)
            return {"url": url, "text": label}
        return {"url": text, "text": ""} if text.startswith("http") else None
    if t == "checkbox":
        return True if isinstance(raw, dict) and str(raw.get("checked")).lower() == "true" else None
    if t == "people":
        return [n.strip() for n in text.split(",") if n.strip()] or None
    if t == "relation":
        # Se guardan los IDs de Monday; resolve_relations() los cambia por IDs propios al final
        return [str(i) for i in cv.get("linked_item_ids") or []] or None
    if t == "file":
        urls = [u.strip() for u in text.split(",") if u.strip().startswith("http")]
        return [{"name": u.rsplit("/", 1)[-1], "url": u} for u in urls] or None
    return None


def _upsert(db, model, monday_id, **fields):
    obj = db.scalar(select(model).where(model.monday_id == str(monday_id)))
    if obj is None:
        obj = model(monday_id=str(monday_id), **fields)
        db.add(obj)
    else:
        for key, value in fields.items():
            setattr(obj, key, value)
    return obj


def _sync_columns(db, board, monday_columns):
    existing = {c.key: c for c in db.scalars(select(Column).where(Column.board_id == board.id))}
    columns = []
    for position, mc in enumerate(monday_columns):
        if mc["type"] in SKIP_TYPES:
            continue
        column_type = TYPE_MAP.get(mc["type"], "text")
        settings = convert_settings(column_type, mc["type"], mc.get("settings_str"))
        settings["monday_type"] = mc["type"]
        column = existing.get(mc["id"])
        if column is None:
            column = Column(board_id=board.id, key=mc["id"])
            db.add(column)
        column.title, column.type, column.settings, column.position = mc["title"], column_type, settings, position
        columns.append(column)
    db.flush()
    return {c.key: c for c in columns}


def _values_from(columns, column_values):
    values = {}
    for cv in column_values:
        column = columns.get(cv["id"])
        if column is None:
            continue
        if column.settings.get("monday_type") not in TYPE_MAP:
            value = (cv.get("text") or "").strip() or None  # fórmulas, espejos, etc. quedan como texto
        else:
            value = convert_value(column, cv)
        if value is not None:
            values[column.key] = value
    return values


def _import_updates(db, item, updates, users_by_email):
    for u in updates or []:
        creator = u.get("creator") or {}
        user = users_by_email.get((creator.get("email") or "").lower())
        _upsert(db, Update, u["id"], item_id=item.id, user_id=user.id if user else None,
                author_name=creator.get("name") or "", body=u.get("text_body") or "",
                created_at=_dt(u.get("created_at")))


def _dt(value):
    if not value:
        return now()
    return datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))


def resolve_relations(db):
    """Cambia los IDs de Monday guardados en columnas de relación por IDs propios."""
    id_map = dict(db.execute(select(Item.monday_id, Item.id).where(Item.monday_id.is_not(None))).all())
    board_map = dict(db.execute(select(Board.monday_id, Board.id).where(Board.monday_id.is_not(None))).all())
    relation_keys = {}
    for column in db.scalars(select(Column).where(Column.type == "relation")):
        relation_keys.setdefault(column.board_id, []).append(column.key)
        linked_boards = [board_map[b] for b in column.settings.get("monday_board_ids", []) if b in board_map]
        if linked_boards:
            column.settings = {**column.settings, "board_ids": linked_boards}
    for board_id, keys in relation_keys.items():
        for item in db.scalars(select(Item).where(Item.board_id == board_id)):
            values = dict(item.values or {})
            changed = False
            for key in keys:
                linked = values.get(key)
                if linked and any(isinstance(v, str) for v in linked):
                    resolved = [id_map[v] if isinstance(v, str) else v for v in linked
                                if not isinstance(v, str) or v in id_map]
                    if resolved:
                        values[key] = resolved
                    else:
                        values.pop(key)
                    changed = True
            if changed:
                item.values = values


def import_monday(db, client, workspace_ids=None, with_updates=False, log=logging.info):
    stats = {"espacios": 0, "carpetas": 0, "tableros": 0, "elementos": 0, "subelementos": 0}
    admins = list(db.scalars(select(User).where(User.role == "admin")))
    users_by_email = {u.email.lower(): u for u in db.scalars(select(User))}

    workspaces = client.workspaces(workspace_ids)
    ws_map = {}
    for position, mw in enumerate(workspaces):
        ws = _upsert(db, Workspace, mw["id"], name=mw["name"], description=mw.get("description") or "",
                     position=position)
        db.flush()
        for admin in admins:
            if not db.get(WorkspaceMember, (ws.id, admin.id)):
                db.add(WorkspaceMember(workspace_id=ws.id, user_id=admin.id))
        ws_map[str(mw["id"])] = ws
        stats["espacios"] += 1
    ids = list(ws_map)

    folder_map = {}
    for position, mf in enumerate(client.folders(ids)):
        ws = ws_map.get(str((mf.get("workspace") or {}).get("id")))
        if ws is None:
            continue
        folder_map[str(mf["id"])] = _upsert(db, Folder, mf["id"], workspace_id=ws.id, name=mf["name"],
                                            position=position)
        stats["carpetas"] += 1
    db.flush()

    monday_boards = client.boards(ids)
    subitem_board_ids = set()
    for mb in monday_boards:
        for mc in mb["columns"]:
            if mc["type"] == "subtasks":
                subitem_board_ids.update(str(b) for b in (_parse(mc.get("settings_str")) or {}).get("boardIds", []))

    for position, mb in enumerate(monday_boards):
        if str(mb["id"]) in subitem_board_ids or mb.get("type") == "sub_items_board":
            continue  # se importan junto a su tablero principal
        ws = ws_map.get(str(mb["workspace_id"]))
        if ws is None:
            continue
        folder = folder_map.get(str(mb.get("board_folder_id")))
        log(f"Importando tablero {mb['name']}...")
        board = _upsert(db, Board, mb["id"], workspace_id=ws.id, folder_id=folder.id if folder else None,
                        name=mb["name"], description=mb.get("description") or "",
                        item_label=mb.get("item_terminology") or "Elemento", kind="main", position=position)
        db.flush()
        columns = _sync_columns(db, board, mb["columns"])

        group_map = {}
        for mg in mb["groups"]:
            group = db.scalar(select(Group).where(Group.board_id == board.id, Group.monday_id == mg["id"]))
            if group is None:
                group = Group(board_id=board.id, monday_id=mg["id"])
                db.add(group)
            group.title, group.color = mg["title"], safe_color(mg.get("color"), "#579bfc")
            group.position = float(mg.get("position") or 0)
            group_map[mg["id"]] = group
        db.flush()

        sub_board, sub_columns = None, None
        sub_ids = [str(b) for mc in mb["columns"] if mc["type"] == "subtasks"
                   for b in (_parse(mc.get("settings_str")) or {}).get("boardIds", [])]
        if sub_ids:
            sub_board = _upsert(db, Board, sub_ids[0], workspace_id=ws.id, name=f"Subelementos de {mb['name']}",
                                kind="subitems")
            db.flush()
            board.subitems_board_id = sub_board.id
            sub_columns = _sync_columns(db, sub_board, client.board_columns(sub_ids[0]))

        for position_item, mi in enumerate(client.items(mb["id"], with_updates)):
            group = group_map.get((mi.get("group") or {}).get("id"))
            item = _upsert(db, Item, mi["id"], board_id=board.id, group_id=group.id if group else None,
                           parent_item_id=None, name=mi["name"][:500],
                           values=_values_from(columns, mi["column_values"]), position=position_item,
                           created_at=_dt(mi.get("created_at")))
            db.flush()
            stats["elementos"] += 1
            _import_updates(db, item, mi.get("updates"), users_by_email)
            for position_sub, ms in enumerate(mi.get("subitems") or []):
                if sub_board is None:
                    break
                sub = _upsert(db, Item, ms["id"], board_id=sub_board.id, group_id=None, parent_item_id=item.id,
                              name=ms["name"][:500], values=_values_from(sub_columns, ms["column_values"]),
                              position=position_sub, created_at=_dt(ms.get("created_at")))
                db.flush()
                stats["subelementos"] += 1
                _import_updates(db, sub, ms.get("updates"), users_by_email)
        stats["tableros"] += 1
        db.commit()

    resolve_relations(db)
    db.commit()
    return stats
