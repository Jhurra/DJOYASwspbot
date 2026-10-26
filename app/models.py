from sqlalchemy import Column, String, DateTime
from app.database import Base


class Conversation(Base):
    """Conversación de OpenAI (Conversations API) asociada a cada usuario de WhatsApp."""
    __tablename__ = 'conversations'
    user_id = Column(String, primary_key=True)
    conversation_id = Column(String, nullable=False)
    updated_at = Column(DateTime(timezone=True), nullable=False)


class ProcessedMessage(Base):
    """IDs de mensajes de WhatsApp ya procesados, para no responder dos veces a los reintentos de Meta."""
    __tablename__ = 'processed_messages'
    message_id = Column(String, primary_key=True)
    created_at = Column(DateTime(timezone=True), nullable=False)
