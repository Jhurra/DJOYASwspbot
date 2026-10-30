import json

from sqlalchemy import select

from app.importer import import_monday
from app.models import Board, Column, Folder, Item, Update, Workspace


def status_settings():
    return json.dumps({
        "labels": {"0": "Contactado", "1": "Ganado", "7": "Calificado", "4": "Vieja"},
        "labels_colors": {"0": {"color": "#fdab3d"}, "1": {"color": "#00c875"}, "7": {"color": "#579bfc"}},
        "labels_positions_v2": {"7": 0, "0": 1, "1": 2},
        "done_colors": [1], "deactivated_labels": [4],
    })


class FakeMonday:
    def workspaces(self, ids=None):
        return [{"id": "5874363", "name": "CRM x SARAHI", "description": None}]

    def folders(self, ids):
        return [{"id": "1266767", "name": "CRM", "workspace": {"id": "5874363"}}]

    def boards(self, ids):
        return [
            {"id": "100", "name": "LEADS Chile", "description": "", "type": "board", "workspace_id": "5874363",
             "board_folder_id": "1266767", "item_terminology": "Prospecto",
             "columns": [
                 {"id": "name", "title": "Name", "type": "name", "settings_str": "{}"},
                 {"id": "subitems", "title": "Tareas", "type": "subtasks", "settings_str": json.dumps({"boardIds": [101]})},
                 {"id": "etapa", "title": "Etapa", "type": "status", "settings_str": status_settings()},
                 {"id": "fuente", "title": "Fuente", "type": "dropdown",
                  "settings_str": json.dumps({"labels": [{"id": 1, "name": "Google"}, {"id": 2, "name": "Instagram"}]})},
                 {"id": "score", "title": "Score", "type": "numbers", "settings_str": json.dumps({"unit": {"symbol": "$"}})},
                 {"id": "email", "title": "Email", "type": "email", "settings_str": "{}"},
                 {"id": "fecha", "title": "Fecha", "type": "date", "settings_str": "{}"},
                 {"id": "li", "title": "LinkedIn", "type": "link", "settings_str": "{}"},
                 {"id": "tel", "title": "WhatsApp", "type": "phone", "settings_str": "{}"},
                 {"id": "formula", "title": "Fórmula", "type": "formula", "settings_str": "{}"},
                 {"id": "rel", "title": "Ventas", "type": "board_relation", "settings_str": json.dumps({"boardIds": [200]})},
             ],
             "groups": [{"id": "topics", "title": "Nuevos", "color": "#579bfc", "position": "1"}]},
            {"id": "101", "name": "Subelementos de LEADS Chile", "type": "sub_items_board", "workspace_id": "5874363",
             "board_folder_id": None, "columns": [], "groups": []},
            {"id": "200", "name": "Ventas", "description": "", "type": "board", "workspace_id": "5874363",
             "board_folder_id": "1266767", "item_terminology": "Oferta",
             "columns": [{"id": "name", "title": "Nombre", "type": "name", "settings_str": "{}"}],
             "groups": [{"id": "topics", "title": "Cross Sellings", "color": "#0086c0", "position": "1"}]},
        ]

    def board_columns(self, board_id):
        return [{"id": "name", "title": "Nombre", "type": "name", "settings_str": "{}"},
                {"id": "status", "title": "Estado", "type": "status", "settings_str": status_settings()}]

    def items(self, board_id, with_updates=False):
        if board_id == "200":
            yield {"id": "9001", "name": "Toke - Plan Pro", "group": {"id": "topics"}, "column_values": []}
            return
        yield {
            "id": "3206881669", "name": "Toke", "created_at": "2026-09-04T17:00:00Z", "group": {"id": "topics"},
            "column_values": [
                {"id": "etapa", "type": "status", "text": "Calificado", "value": None},
                {"id": "fuente", "type": "dropdown", "text": "Google", "value": json.dumps({"ids": [1]})},
                {"id": "score", "type": "numbers", "text": "76", "value": '"76"'},
                {"id": "email", "type": "email", "text": "nicolas@toke.cl", "value": None},
                {"id": "fecha", "type": "date", "text": "2026-09-07", "value": json.dumps({"date": "2026-09-07"})},
                {"id": "li", "type": "link", "text": "Nicolás - https://linkedin.com/in/n",
                 "value": json.dumps({"url": "https://linkedin.com/in/n", "text": "Nicolás"})},
                {"id": "tel", "type": "phone", "text": "+56953315863", "value": None},
                {"id": "formula", "type": "formula", "text": "152", "value": None},
                {"id": "rel", "type": "board_relation", "text": None, "value": None, "linked_item_ids": ["9001"]},
            ],
            "updates": [{"id": "u1", "text_body": "Primer contacto", "created_at": "2026-09-05T10:00:00Z",
                         "creator": {"name": "SARAHI AGENCY", "email": "jorge@sarahi.cl"}}],
            "subitems": [{"id": "5001", "name": "Enviar radiografía", "column_values": [
                {"id": "status", "type": "status", "text": "Ganado", "value": json.dumps({"index": 1})}]}],
        }


def test_import_maps_everything(db, setup):
    stats = import_monday(db, FakeMonday(), with_updates=True)
    assert stats == {"espacios": 1, "carpetas": 1, "tableros": 2, "elementos": 2, "subelementos": 1}

    ws = db.scalar(select(Workspace).where(Workspace.monday_id == "5874363"))
    board = db.scalar(select(Board).where(Board.monday_id == "100"))
    assert board.workspace_id == ws.id and board.item_label == "Prospecto"
    assert board.folder_id == db.scalar(select(Folder.id).where(Folder.monday_id == "1266767"))
    assert board.subitems_board_id is not None

    cols = {c.key: c for c in db.scalars(select(Column).where(Column.board_id == board.id))}
    assert "name" not in cols and "subitems" not in cols
    # Etiquetas desactivadas fuera, orden de Monday respetado, "done" marcado
    assert [l["label"] for l in cols["etapa"].settings["labels"]] == ["Calificado", "Contactado", "Ganado"]
    assert next(l for l in cols["etapa"].settings["labels"] if l["label"] == "Ganado")["done"] is True
    assert cols["formula"].type == "text"

    toke = db.scalar(select(Item).where(Item.monday_id == "3206881669"))
    venta = db.scalar(select(Item).where(Item.monday_id == "9001"))
    assert toke.values == {
        "etapa": "7", "fuente": ["1"], "score": 76, "email": "nicolas@toke.cl", "fecha": "2026-09-07",
        "li": {"url": "https://linkedin.com/in/n", "text": "Nicolás"}, "tel": "+56953315863", "formula": "152",
        "rel": [venta.id],
    }
    ventas_board = db.scalar(select(Board).where(Board.monday_id == "200"))
    assert cols["rel"].settings["board_ids"] == [ventas_board.id]

    sub = db.scalar(select(Item).where(Item.parent_item_id == toke.id))
    assert sub.name == "Enviar radiografía" and sub.values == {"status": "1"}
    update = db.scalar(select(Update).where(Update.item_id == toke.id))
    assert update.body == "Primer contacto" and update.user_id == setup["jorge"]


def test_import_is_idempotent(db, setup):
    import_monday(db, FakeMonday())
    import_monday(db, FakeMonday())
    assert len(db.scalars(select(Item)).all()) == 3
    assert len(db.scalars(select(Board)).all()) == 3
