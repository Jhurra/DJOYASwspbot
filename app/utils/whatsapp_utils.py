import logging
import json
import re
import httpx
from app.services.openai_service import generate_response
import os

async def send_message(data):
    headers = {
        "Content-type": "application/json",
        "Authorization": f"Bearer {os.getenv('ACCESS_TOKEN')}",
    }
    url = f"https://graph.facebook.com/{os.getenv('VERSION')}/{os.getenv('PHONE_NUMBER_ID')}/messages"

    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(url, data=data, headers=headers, timeout=10)
            response.raise_for_status()
        except httpx.TimeoutException:
            logging.error("Timeout occurred while sending message")
            return {"status": "error", "message": "Request timed out"}, 408
        except httpx.HTTPError as e:
            logging.error(f"Request failed due to: {e}")
            return {"status": "error", "message": "Failed to send message"}, 500
        else:
            logging.info(f"Message sent successfully: {response.text}")
            return response.json()

def process_text_for_whatsapp(text):
    # Remove brackets
    pattern = r"\【.*?\】"
    text = re.sub(pattern, "", text).strip()
    # Replace double asterisks with single asterisks
    pattern = r"\*\*(.*?)\*\*"
    replacement = r"*\1*"
    whatsapp_style_text = re.sub(pattern, replacement, text)
    return whatsapp_style_text

async def process_message(message_body, wa_id, name):
    try:
        response = await generate_response(message_body, wa_id, name)
        response = process_text_for_whatsapp(response)
        data = get_text_message_input(wa_id, response)
        await send_message(data)
        logging.info(f"Message processed and sent to {wa_id}")
    except Exception as e:
        logging.error(f"Failed to process message for {wa_id}: {e}")

def get_text_message_input(recipient, text):
    return json.dumps(
        {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": recipient,
            "type": "text",
            "text": {"preview_url": False, "body": text}
        }
    )

async def process_whatsapp_message(body):
    wa_id = body["entry"][0]["changes"][0]["value"]["contacts"][0]["wa_id"]
    name = body["entry"][0]["changes"][0]["value"]["contacts"][0]["profile"]["name"]

    if body["entry"][0]["changes"][0]["value"]["messages"][0]["type"] == "request_welcome":
        message_body = "Da la Bienvenida"
    else:
        message_body = body["entry"][0]["changes"][0]["value"]["messages"][0]["text"]["body"]

    logging.info(f"Processing message for {wa_id}: {message_body}")
    await process_message(message_body, wa_id, name)

def is_valid_whatsapp_message(body):
    return (
        body.get("object")
        and body.get("entry")
        and body["entry"][0].get("changes")
        and body["entry"][0]["changes"][0].get("value")
        and body["entry"][0]["changes"][0]["value"].get("messages")
        and body["entry"][0]["changes"][0]["value"]["messages"][0]
    )
