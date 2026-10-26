from fastapi import APIRouter, BackgroundTasks, Request, HTTPException, Depends
from fastapi.responses import PlainTextResponse
from app.utils.whatsapp_utils import process_whatsapp_message, is_valid_whatsapp_message
from app.utils.security import verify_signature
import hmac
import os
import logging

webhook_router = APIRouter()

@webhook_router.get("/webhook")
async def verify(request: Request):
    params = request.query_params
    mode = params.get("hub.mode")
    token = params.get("hub.verify_token")
    challenge = params.get("hub.challenge")
    verify_token = os.getenv("VERIFY_TOKEN")

    if mode and token:
        if mode == "subscribe" and verify_token and hmac.compare_digest(token, verify_token):
            logging.info("WEBHOOK_VERIFIED")
            return PlainTextResponse(content=challenge, status_code=200)
        else:
            logging.error("Verification failed")
            raise HTTPException(status_code=403, detail="Verification failed")
    else:
        logging.error("Verification failed, missing parameters")
        raise HTTPException(status_code=400, detail="Missing parameters")

@webhook_router.post("/webhook")
async def webhook_post(request: Request, background_tasks: BackgroundTasks, verified: None = Depends(verify_signature)):
    try:
        body = await request.json()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    # Meta exige un 200 rápido; si tarda, reintenta y el cliente recibiría respuestas duplicadas.
    # Por eso la respuesta de OpenAI se genera en segundo plano.
    if is_valid_whatsapp_message(body):
        background_tasks.add_task(process_whatsapp_message, body)
    else:
        # Notificaciones de estado (enviado, entregado, leído): se confirman sin hacer nada
        logging.debug("Evento de WhatsApp sin mensaje entrante")
    return {"status": "ok"}
