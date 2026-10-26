"""Migrar de threads (Assistants API) a conversations (Responses API)

Revision ID: 3f1a2c9d8e7b
Revises: bc77d50dea41
Create Date: 2026-10-26 12:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '3f1a2c9d8e7b'
down_revision: Union[str, None] = 'bc77d50dea41'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Los thread_id de la Assistants API ya no sirven (la API se apagó el 26/08/2026),
    # así que la tabla vieja se elimina en lugar de migrar sus datos.
    op.create_table('conversations',
    sa.Column('user_id', sa.String(), nullable=False),
    sa.Column('conversation_id', sa.String(), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('user_id')
    )
    op.create_table('processed_messages',
    sa.Column('message_id', sa.String(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('message_id')
    )
    op.drop_table('threads')


def downgrade() -> None:
    op.create_table('threads',
    sa.Column('user_id', sa.String(), nullable=False),
    sa.Column('thread_id', sa.String(), nullable=True),
    sa.Column('timestamp', sa.DateTime(), nullable=True),
    sa.PrimaryKeyConstraint('user_id')
    )
    op.drop_table('processed_messages')
    op.drop_table('conversations')
