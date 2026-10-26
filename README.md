# DJOYAS – Bot de WhatsApp

Bot de WhatsApp (Cloud API de Meta) que responde con OpenAI. Hecho con FastAPI + PostgreSQL.

## Cómo funciona

1. Meta envía cada mensaje a `POST /webhook`. Se valida la firma (`APP_SECRET`) y se responde `200` al instante.
2. En segundo plano, el mensaje se manda a OpenAI (Responses API + Conversations). Cada cliente tiene su propia conversación, que se reinicia después de `CONVERSATION_TTL_HOURS` sin actividad.
3. La respuesta se adapta al formato de WhatsApp y se envía (en varias partes si supera 4096 caracteres).

Los reintentos de Meta se ignoran (tabla `processed_messages`), así el cliente nunca recibe la misma respuesta dos veces.

## Configuración

```bash
cp .env.example .env   # y completar los valores
pip install -r requirements.txt
alembic upgrade head
```

### OpenAI

La Assistants API se apagó el 26/08/2026, así que el `OPENAI_ASSISTANT_ID` ya no sirve. Para pasar el asistente:

1. En platform.openai.com → **Chat / Prompts**, crea un Prompt con el mismo modelo, las mismas instrucciones y, si usabas archivos, la herramienta *File search* con el mismo vector store.
2. Copia el ID (`pmpt_...`) en `OPENAI_PROMPT_ID`.

Alternativa sin Prompt: `OPENAI_MODEL`, `OPENAI_INSTRUCTIONS` y `OPENAI_VECTOR_STORE_ID`.

## Ejecutar

```bash
# local
uvicorn main:app --reload --port 8000

# producción
gunicorn main:app -k uvicorn.workers.UvicornWorker -w 2 -b 0.0.0.0:$PORT
```

En Meta (WhatsApp → Configuración → Webhook) usa `https://TU-DOMINIO/webhook`, el mismo `VERIFY_TOKEN` del `.env`, y suscríbete al campo `messages`. `GET /health` sirve como health check.

## Tests

```bash
pip install -r requirements-dev.txt
pytest
```
