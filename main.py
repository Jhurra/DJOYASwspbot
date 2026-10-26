import logging
from fastapi import FastAPI
from app.routes import webhook_router

logging.basicConfig(
    level=logging.INFO,  # Puedes cambiar a DEBUG para más detalles
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

app.include_router(webhook_router)

@app.get("/")
async def root():
    return {"message": "WhatsApp Bot is running"}

@app.get("/health")
async def health():
    return {"status": "ok"}
