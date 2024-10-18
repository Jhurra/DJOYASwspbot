from fastapi import Request, HTTPException
import hmac
import hashlib
import os
import logging

async def verify_signature(request: Request):
    signature_header = request.headers.get("X-Hub-Signature-256", "")
    if not signature_header.startswith("sha256="):
        logging.warning("Invalid signature format")
        raise HTTPException(status_code=403, detail="Invalid signature format")

    signature = signature_header[7:]  # Remover 'sha256='
    body = await request.body()

    app_secret = os.getenv('APP_SECRET')
    if not app_secret:
        logging.error("APP_SECRET not set in environment variables")
        raise HTTPException(status_code=500, detail="Server configuration error")

    expected_signature = hmac.new(
        key=app_secret.encode('utf-8'),
        msg=body,
        digestmod=hashlib.sha256
    ).hexdigest()

    if not hmac.compare_digest(expected_signature, signature):
        logging.warning("Signature mismatch")
        raise HTTPException(status_code=403, detail="Invalid signature")
