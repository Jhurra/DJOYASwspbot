import asyncio
from dotenv import load_dotenv
from openai import OpenAI
import os
import time
import logging

thread_lock = asyncio.Lock()

load_dotenv()
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')
OPENAI_ASSISTANT_ID = os.getenv('OPENAI_ASSISTANT_ID')
client = OpenAI(api_key=OPENAI_API_KEY)
client.timeout = 10

async def check_if_thread_exists(user_id, expiration_time=3600*10):
    from ..models import Thread
    from ..database import async_session
    import datetime
    from sqlalchemy.future import select

    async with async_session() as session:
        result = await session.execute(select(Thread).where(Thread.user_id == user_id))
        thread = result.scalars().first()
        if thread:
            time_difference = datetime.datetime.now() - thread.timestamp
            if time_difference <= datetime.timedelta(seconds=expiration_time):
                return thread.thread_id
    return None

async def store_thread(user_id, thread_id):
    from ..models import Thread
    from ..database import async_session
    import datetime
    from sqlalchemy.future import select

    current_time = datetime.datetime.now()

    async with async_session() as session:
        result = await session.execute(select(Thread).where(Thread.user_id == user_id))
        thread = result.scalars().first()
        if thread:
            thread.thread_id = thread_id
            thread.timestamp = current_time
        else:
            new_thread = Thread(user_id=user_id, thread_id=thread_id, timestamp=current_time)
            session.add(new_thread)
        await session.commit()

async def run_assistant(thread, name):
    import asyncio

    try:
        assistant = await asyncio.to_thread(client.beta.assistants.retrieve, OPENAI_ASSISTANT_ID)

        run = await asyncio.to_thread(
            client.beta.threads.runs.create,
            thread_id=thread.id,
            assistant_id=assistant.id,
            # instructions=f"You are having a conversation with {name}",
        )
        logging.info(f"Thread id: {thread.id}")

        while run.status not in ["completed", "failed", "cancelled", "expired"]:
            await asyncio.sleep(0.5)
            logging.info(f"Consultando para Thread id: {thread.id}")
            logging.info(f"Run status: {run.status}")
            run = await asyncio.to_thread(client.beta.threads.runs.retrieve, thread_id=thread.id, run_id=run.id)

        if run.status in ["failed", "cancelled", "expired"]:
            logging.error(f"Failed to run assistant for thread {thread.id}")
            failed_message = "Lo sentimos, algo ha fallado, por favor inténtelo de nuevo más tarde."
            return failed_message

        messages = await asyncio.to_thread(client.beta.threads.messages.list, thread_id=thread.id)
        new_message = messages.data[0].content[0].text.value
        logging.info(f"Generated message: {new_message}")
        return new_message
    except Exception as e:
        logging.error(f"Error en run_assistant: {e}")
        return "Lo sentimos, ocurrió un error al procesar tu solicitud."

async def generate_response(message_body, user_id, name):
    try:
        async with thread_lock:
            thread_id = await check_if_thread_exists(user_id)
            if thread_id is None:
                logging.info(f"Creating new thread for {name} with user_id {user_id}")
                thread = await asyncio.to_thread(client.beta.threads.create)
                await store_thread(user_id, thread.id)
                thread_id = thread.id
            else:
                logging.info(f"Retrieving existing thread for {name} with user_id {user_id}")
                thread = await asyncio.to_thread(client.beta.threads.retrieve, thread_id)
                await store_thread(user_id, thread_id)

            # Añadir mensaje al thread
            message = await asyncio.to_thread(
                client.beta.threads.messages.create,
                thread_id=thread_id,
                role="user",
                content=message_body,
            )

            # Ejecutar el asistente y obtener el nuevo mensaje
            new_message = await run_assistant(thread, name)
            return new_message
    except Exception as e:
        logging.error(f"Error al generar respuesta: {e}")
        return "Lo sentimos, ocurrió un error al procesar tu solicitud."
