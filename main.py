import logging
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse
from app.routes import webhook_router

logging.basicConfig(
    level=logging.INFO,  # Puedes cambiar a DEBUG para más detalles
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)

app = FastAPI()

app.include_router(webhook_router)

@app.get("/")
async def root():
    return {"message": "WhatsApp Bot is running"}
