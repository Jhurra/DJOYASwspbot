"""Tipos de columna y validación de valores.

Formato guardado en Item.values[column.key]:
  text, long_text, email, phone -> str
  number                        -> int | float
  status                        -> id de etiqueta (str)
  dropdown                      -> [id de etiqueta, ...]
  date                          -> "YYYY-MM-DD"
  timeline                      -> {"from": "YYYY-MM-DD", "to": "YYYY-MM-DD"}
  link                          -> {"url": "https://...", "text": "..."}
  checkbox                      -> bool
  people                        -> [nombre, ...]
  relation                      -> [id de elemento, ...]
  file                          -> [{"name": "...", "url": "https://..."}, ...]
"""
import datetime
import re

COLUMN_TYPES = {
    "text", "long_text", "number", "status", "dropdown", "date", "timeline",
    "email", "phone", "link", "checkbox", "people", "relation", "file",
}
LABEL_TYPES = {"status", "dropdown"}
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_COLOR = re.compile(r"^#[0-9a-fA-F]{3,8}$")


def safe_color(color, default="#c4c4c4"):
    return color if isinstance(color, str) and _COLOR.match(color) else default


def _is_safe_url(url):
    # Evita enlaces javascript: o data: que ejecutarían código al hacer clic
    return isinstance(url, str) and url.lower().startswith(("http://", "https://", "mailto:", "tel:"))


def _date(value):
    datetime.date.fromisoformat(value)
    return value


def label_ids(column):
    return {str(label["id"]) for label in column.settings.get("labels", [])}


def normalize_value(column, value):
    """Devuelve el valor validado para guardar, o None para vaciar la celda. Lanza ValueError si no es válido."""
    if value is None or value == "" or value == []:
        return None
    t = column.type
    if t in ("text", "long_text", "phone"):
        return str(value).strip() or None
    if t == "email":
        value = str(value).strip()
        if not _EMAIL.match(value):
            raise ValueError("Email no válido")
        return value
    if t == "number":
        if isinstance(value, bool):
            raise ValueError("Número no válido")
        if isinstance(value, str):
            value = value.replace(",", ".").strip()
        number = float(value)
        return int(number) if number.is_integer() else number
    if t == "status":
        value = str(value)
        if value not in label_ids(column):
            raise ValueError("Etiqueta inexistente")
        return value
    if t == "dropdown":
        if not isinstance(value, list):
            raise ValueError("Se esperaba una lista")
        valid = label_ids(column)
        ids = [str(v) for v in value]
        if any(v not in valid for v in ids):
            raise ValueError("Etiqueta inexistente")
        return list(dict.fromkeys(ids)) or None
    if t == "date":
        return _date(str(value)[:10])
    if t == "timeline":
        if not isinstance(value, dict):
            raise ValueError("Se esperaba {from, to}")
        start, end = value.get("from"), value.get("to")
        if not start and not end:
            return None
        return {"from": _date(start) if start else None, "to": _date(end) if end else None}
    if t == "link":
        if isinstance(value, str):
            value = {"url": value}
        url = str(value.get("url", "")).strip()
        if not url:
            return None
        if not _is_safe_url(url):
            raise ValueError("El enlace debe empezar con http:// o https://")
        return {"url": url, "text": str(value.get("text") or "").strip()}
    if t == "checkbox":
        return bool(value) or None
    if t == "people":
        if isinstance(value, str):
            value = value.split(",")
        return [str(v).strip() for v in value if str(v).strip()] or None
    if t == "relation":
        if not isinstance(value, list):
            raise ValueError("Se esperaba una lista")
        return [int(v) for v in value] or None
    if t == "file":
        if not isinstance(value, list):
            raise ValueError("Se esperaba una lista")
        files = []
        for f in value:
            url = str(f.get("url", "")).strip()
            if not _is_safe_url(url):
                raise ValueError("El enlace debe empezar con http:// o https://")
            files.append({"name": str(f.get("name") or url), "url": url})
        return files or None
    raise ValueError(f"Tipo de columna desconocido: {t}")


def normalize_settings(column_type, settings):
    """Valida la configuración de una columna (etiquetas de status/dropdown, unidad de números)."""
    settings = dict(settings or {})
    if column_type in LABEL_TYPES:
        raw = settings.get("labels", [])
        numeric = [int(str(l["id"])) for l in raw if l.get("id") is not None and str(l["id"]).isdigit()]
        next_id = max(numeric, default=-1) + 1
        labels, seen = [], set()
        for label in raw:
            name = str(label.get("label", "")).strip()
            if not name:
                continue
            label_id = str(label["id"]).strip() if label.get("id") is not None else ""
            if not label_id or label_id in seen:
                label_id = str(next_id)
                next_id += 1
            seen.add(label_id)
            labels.append({
                "id": label_id,
                "label": name,
                "color": safe_color(label.get("color")),
                "done": bool(label.get("done")),
            })
        settings["labels"] = labels
    return settings
