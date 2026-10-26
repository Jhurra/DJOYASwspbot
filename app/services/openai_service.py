import asyncio
import datetime
import logging
import os
from collections import defaultdict

from dotenv import load_dotenv
from openai import AsyncOpenAI
from sqlalchemy import select

from app.database import async_session
from app.models import Conversation

load_dotenv()

# La Assistants API se apagó el 26/08/2026. El bot usa ahora Responses API + Conversations.
# Configuración recomendada: crear un "Prompt" en el dashboard de OpenAI (modelo, instrucciones
# y herramientas como file_search) y poner su ID en OPENAI_PROMPT_ID.
# Alternativa sin Prompt: OPENAI_MODEL + OPENAI_INSTRUCTIONS (+ OPENAI_VECTOR_STORE_ID).
OPENAI_PROMPT_ID = os.getenv('OPENAI_PROMPT_ID')
OPENAI_PROMPT_VERSION = os.getenv('OPENAI_PROMPT_VERSION')
OPENAI_MODEL = os.getenv('OPENAI_MODEL', 'gpt-4.1-mini')
OPENAI_INSTRUCTIONS = os.getenv('OPENAI_INSTRUCTIONS')
OPENAI_VECTOR_STORE_ID = os.getenv('OPENAI_VECTOR_STORE_ID')
# Horas sin mensajes tras las cuales se empieza una conversación nueva
CONVERSATION_TTL_HOURS = float(os.getenv('CONVERSATION_TTL_HOURS', '10'))

client = AsyncOpenAI(api_key=os.getenv('OPENAI_API_KEY'), timeout=60, max_retries=2)

FAILED_MESSAGE = "Lo sentimos, ocurrió un error al procesar tu solicitud. Por favor, inténtalo de nuevo en unos minutos."

# Un lock por usuario: los mensajes de una misma persona se procesan en orden,
# pero distintos usuarios no se bloquean entre sí.
_user_locks = defaultdict(asyncio.Lock)


def _now():
    return datetime.datetime.now(datetime.timezone.utc)


async def get_conversation_id(user_id):
    async with async_session() as session:
        result = await session.execute(select(Conversation).where(Conversation.user_id == user_id))
        conversation = result.scalars().first()
        if conversation:
            updated_at = conversation.updated_at
            if updated_at.tzinfo is None:
                updated_at = updated_at.replace(tzinfo=datetime.timezone.utc)
            if _now() - updated_at <= datetime.timedelta(hours=CONVERSATION_TTL_HOURS):
                return conversation.conversation_id
    return None


async def store_conversation(user_id, conversation_id):
    async with async_session() as session:
        conversation = await session.get(Conversation, user_id)
        if conversation:
            conversation.conversation_id = conversation_id
            conversation.updated_at = _now()
        else:
            session.add(Conversation(user_id=user_id, conversation_id=conversation_id, updated_at=_now()))
        await session.commit()


def _response_options():
    if OPENAI_PROMPT_ID:
        prompt = {"id": OPENAI_PROMPT_ID}
        if OPENAI_PROMPT_VERSION:
            prompt["version"] = OPENAI_PROMPT_VERSION
        return {"prompt": prompt}

    options = {"model": OPENAI_MODEL}
    if OPENAI_INSTRUCTIONS:
        options["instructions"] = OPENAI_INSTRUCTIONS
    if OPENAI_VECTOR_STORE_ID:
        options["tools"] = [{"type": "file_search", "vector_store_ids": [OPENAI_VECTOR_STORE_ID]}]
    return options


async def generate_response(message_body, user_id, name):
    try:
        async with _user_locks[user_id]:
            conversation_id = await get_conversation_id(user_id)
            if conversation_id is None:
                logging.info(f"Creando conversación nueva para {user_id}")
                conversation = await client.conversations.create(metadata={"wa_id": user_id})
                conversation_id = conversation.id

            response = await client.responses.create(
                conversation=conversation_id,
                input=[{"role": "user", "content": message_body}],
                **_response_options(),
            )
            await store_conversation(user_id, conversation_id)

            if response.status != "completed" or not response.output_text:
                logging.error(f"Respuesta incompleta para {user_id}: status={response.status}")
                return FAILED_MESSAGE
            return response.output_text
    except Exception:
        logging.exception(f"Error al generar respuesta para {user_id}")
        return FAILED_MESSAGE
