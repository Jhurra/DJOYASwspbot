import datetime
import logging
import os
import re

import httpx
from sqlalchemy.exc import IntegrityError

from app.database import async_session
from app.models import ProcessedMessage
from app.services.openai_service import generate_response

# WhatsApp rechaza textos de más de 4096 caracteres
MAX_WHATSAPP_TEXT = 4096
UNSUPPORTED_MESSAGE = "Por ahora solo puedo leer mensajes de texto. ¿Me escribes tu consulta, por favor?"


async def send_message(payload):
    headers = {"Authorization": f"Bearer {os.getenv('ACCESS_TOKEN')}"}
    url = f"https://graph.facebook.com/{os.getenv('VERSION', 'v21.0')}/{os.getenv('PHONE_NUMBER_ID')}/messages"

    async with httpx.AsyncClient(timeout=10) as client:
        try:
            response = await client.post(url, json=payload, headers=headers)
            response.raise_for_status()
        except httpx.TimeoutException:
            logging.error("Timeout al enviar el mensaje a WhatsApp")
            return None
        except httpx.HTTPStatusError as e:
            logging.error(f"WhatsApp respondió {e.response.status_code}: {e.response.text}")
            return None
        except httpx.HTTPError as e:
            logging.error(f"Error al enviar el mensaje a WhatsApp: {e}")
            return None
        return response.json()


def process_text_for_whatsapp(text):
    # Quitar las citas de file_search (【4:0†fuente】)
    text = re.sub(r"【.*?】", "", text).strip()
    # Markdown **negrita** -> formato de WhatsApp *negrita*
    return re.sub(r"\*\*(.*?)\*\*", r"*\1*", text)


def split_text(text, limit=MAX_WHATSAPP_TEXT):
    """Divide textos largos en partes que WhatsApp acepte, cortando en saltos de línea o espacios."""
    parts = []
    while len(text) > limit:
        cut = text.rfind("\n", 0, limit)
        if cut <= 0:
            cut = text.rfind(" ", 0, limit)
        if cut <= 0:
            cut = limit
        parts.append(text[:cut].rstrip())
        text = text[cut:].lstrip()
    if text:
        parts.append(text)
    return parts


def get_text_message_input(recipient, text):
    return {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": recipient,
        "type": "text",
        "text": {"preview_url": False, "body": text},
    }


async def send_text(recipient, text):
    for part in split_text(text):
        await send_message(get_text_message_input(recipient, part))


async def mark_as_processed(message_id):
    """Devuelve False si el mensaje ya se había procesado (Meta reintenta webhooks)."""
    async with async_session() as session:
        session.add(ProcessedMessage(message_id=message_id, created_at=datetime.datetime.now(datetime.timezone.utc)))
        try:
            await session.commit()
        except IntegrityError:
            return False
    return True


def extract_message(body):
    """Extrae (message_id, wa_id, nombre, texto) del webhook. texto es None si el tipo no es soportado."""
    value = body["entry"][0]["changes"][0]["value"]
    message = value["messages"][0]
    contact = (value.get("contacts") or [{}])[0]
    wa_id = contact.get("wa_id") or message["from"]
    name = contact.get("profile", {}).get("name", "")

    message_type = message.get("type")
    if message_type == "text":
        text = message["text"]["body"]
    elif message_type == "request_welcome":
        text = "Da la Bienvenida"
    elif message_type == "button":
        text = message["button"].get("text")
    elif message_type == "interactive":
        interactive = message["interactive"]
        reply = interactive.get("button_reply") or interactive.get("list_reply") or {}
        text = reply.get("title")
    else:
        text = None
    return message.get("id"), wa_id, name, text


async def process_whatsapp_message(body):
    try:
        message_id, wa_id, name, message_body = extract_message(body)
    except (KeyError, IndexError, TypeError):
        logging.exception("No se pudo leer el mensaje del webhook")
        return

    try:
        if message_id and not await mark_as_processed(message_id):
            logging.info(f"Mensaje {message_id} duplicado, se ignora")
            return

        if not message_body:
            await send_text(wa_id, UNSUPPORTED_MESSAGE)
            return

        logging.info(f"Procesando mensaje {message_id} de {wa_id}")
        response = await generate_response(message_body, wa_id, name)
        await send_text(wa_id, process_text_for_whatsapp(response))
        logging.info(f"Respuesta enviada a {wa_id}")
    except Exception:
        logging.exception(f"Error al procesar el mensaje para {wa_id}")


def is_valid_whatsapp_message(body):
    try:
        return bool(body.get("object") and body["entry"][0]["changes"][0]["value"]["messages"][0])
    except (KeyError, IndexError, TypeError, AttributeError):
        return False
