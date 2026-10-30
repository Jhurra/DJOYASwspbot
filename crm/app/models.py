import datetime

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def now():
    return datetime.datetime.now(datetime.timezone.utc)


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    password_hash: Mapped[str] = mapped_column(String(255))
    # admin: ve y administra todo. member: solo los espacios de trabajo donde es miembro.
    role: Mapped[str] = mapped_column(String(20), default="member")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True), default=now)


class Session(Base):
    __tablename__ = "sessions"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    expires_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True))
    user: Mapped[User] = relationship()


class Workspace(Base):
    __tablename__ = "workspaces"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text, default="")
    position: Mapped[float] = mapped_column(Float, default=0)
    monday_id: Mapped[str | None] = mapped_column(String(32), unique=True, nullable=True)


class WorkspaceMember(Base):
    __tablename__ = "workspace_members"
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)


class Folder(Base):
    __tablename__ = "folders"
    id: Mapped[int] = mapped_column(primary_key=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    position: Mapped[float] = mapped_column(Float, default=0)
    monday_id: Mapped[str | None] = mapped_column(String(32), unique=True, nullable=True)


class Board(Base):
    __tablename__ = "boards"
    id: Mapped[int] = mapped_column(primary_key=True)
    workspace_id: Mapped[int] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), index=True)
    folder_id: Mapped[int | None] = mapped_column(ForeignKey("folders.id", ondelete="SET NULL"), nullable=True)
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text, default="")
    # Cómo se llama cada elemento: "Lead", "Oferta", "Tarea"...
    item_label: Mapped[str] = mapped_column(String(64), default="Elemento")
    # Los subelementos viven en un tablero propio (kind="subitems") con sus propias columnas
    kind: Mapped[str] = mapped_column(String(20), default="main")
    subitems_board_id: Mapped[int | None] = mapped_column(ForeignKey("boards.id", ondelete="SET NULL"), nullable=True)
    position: Mapped[float] = mapped_column(Float, default=0)
    monday_id: Mapped[str | None] = mapped_column(String(32), unique=True, nullable=True)


class Column(Base):
    __tablename__ = "columns"
    id: Mapped[int] = mapped_column(primary_key=True)
    board_id: Mapped[int] = mapped_column(ForeignKey("boards.id", ondelete="CASCADE"), index=True)
    # Clave estable dentro del tablero; es la llave de Item.values
    key: Mapped[str] = mapped_column(String(64))
    title: Mapped[str] = mapped_column(String(255))
    type: Mapped[str] = mapped_column(String(20))
    settings: Mapped[dict] = mapped_column(JSON, default=dict)
    position: Mapped[float] = mapped_column(Float, default=0)


class Group(Base):
    __tablename__ = "groups"
    id: Mapped[int] = mapped_column(primary_key=True)
    board_id: Mapped[int] = mapped_column(ForeignKey("boards.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(255))
    color: Mapped[str] = mapped_column(String(16), default="#579bfc")
    position: Mapped[float] = mapped_column(Float, default=0)
    monday_id: Mapped[str | None] = mapped_column(String(64), nullable=True)


class Item(Base):
    __tablename__ = "items"
    id: Mapped[int] = mapped_column(primary_key=True)
    board_id: Mapped[int] = mapped_column(ForeignKey("boards.id", ondelete="CASCADE"), index=True)
    group_id: Mapped[int | None] = mapped_column(ForeignKey("groups.id", ondelete="SET NULL"), nullable=True, index=True)
    parent_item_id: Mapped[int | None] = mapped_column(ForeignKey("items.id", ondelete="CASCADE"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(500))
    values: Mapped[dict] = mapped_column(JSON, default=dict)
    position: Mapped[float] = mapped_column(Float, default=0)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)
    monday_id: Mapped[str | None] = mapped_column(String(32), unique=True, nullable=True)


class Update(Base):
    """Comentarios de un elemento (las "actualizaciones" de Monday)."""
    __tablename__ = "updates"
    id: Mapped[int] = mapped_column(primary_key=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    author_name: Mapped[str] = mapped_column(String(255), default="")
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True), default=now)
    monday_id: Mapped[str | None] = mapped_column(String(32), unique=True, nullable=True)
