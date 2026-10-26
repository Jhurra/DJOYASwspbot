from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy.orm import declarative_base
import os
from dotenv import load_dotenv

load_dotenv()


def get_database_url(async_driver=True):
    url = os.getenv('DATABASE_URL')
    if not url:
        raise RuntimeError("DATABASE_URL no está configurada")
    # Render/Heroku entregan "postgres://", que SQLAlchemy 2 ya no acepta
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if async_driver and url.startswith("postgresql://"):
        url = "postgresql+asyncpg://" + url[len("postgresql://"):]
    return url


engine = create_async_engine(get_database_url(), echo=False, pool_pre_ping=True)
async_session = async_sessionmaker(engine, expire_on_commit=False)

Base = declarative_base()
