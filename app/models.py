from sqlalchemy import Column, String, DateTime
from app.database import Base


class Thread(Base):
    __tablename__ = 'threads'
    user_id = Column(String, primary_key=True)
    thread_id = Column(String)
    timestamp = Column(DateTime)

    def __init__(self, user_id, thread_id, timestamp):
        self.user_id = user_id
        self.thread_id = thread_id
        self.timestamp = timestamp
