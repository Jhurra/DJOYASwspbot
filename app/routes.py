from fastapi import APIRouter, Request, HTTPException, Depends
from fastapi.responses import PlainTextResponse
from app.utils.whatsapp_utils import process_whatsapp_message, is_valid_whatsapp_message
from app.utils.security import verify_signature
import os
import logging

webhook_router = APIRouter()

@webhook_router.get("/webhook")
async def verify(request: Request):
    params = request.query_params
    mode = params.get("hub.mode")
    token = params.get("hub.verify_token")
    challenge = params.get("hub.challenge")
    
    if mode and token:
        if mode == "subscribe" and token == os.getenv("VERIFY_TOKEN"):
            logging.info("WEBHOOK_VERIFIED")
            return PlainTextResponse(content=challenge, status_code=200)
        else:
            logging.error("Verification failed")
            raise HTTPException(status_code=403, detail="Verification failed")
    else:
        logging.error("Verification failed, missing parameters")
        raise HTTPException(status_code=400, detail="Missing parameters")

@webhook_router.post("/webhook")
async def webhook_post(request: Request, verified: None = Depends(verify_signature)):
    body = await request.json()
    if is_valid_whatsapp_message(body):
        await process_whatsapp_message(body)
        return {"status": "ok"}
    else:
        logging.error("Not a WhatsApp API event")
        raise HTTPException(status_code=404, detail="Not a WhatsApp API event")
