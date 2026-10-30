import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

os.environ["DATABASE_URL"] = "sqlite:///./test_crm.db"
os.environ["COOKIE_SECURE"] = "false"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.auth import hash_password  # noqa: E402
from app.db import Base, SessionLocal, engine  # noqa: E402
from app.models import User, Workspace, WorkspaceMember  # noqa: E402


@pytest.fixture(autouse=True)
def db():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    session = SessionLocal()
    yield session
    session.close()


@pytest.fixture
def setup(db):
    """Jorge (admin) + Georgia (miembro solo de Clientes). CRM es solo para Jorge."""
    jorge = User(email="jorge@sarahi.cl", name="Jorge", password_hash=hash_password("clave-segura"), role="admin")
    georgia = User(email="georgia@sarahi.cl", name="Georgia", password_hash=hash_password("clave-segura"), role="member")
    crm = Workspace(name="CRM y Ventas")
    clientes = Workspace(name="Clientes SARAHI")
    db.add_all([jorge, georgia, crm, clientes])
    db.flush()
    db.add_all([WorkspaceMember(workspace_id=crm.id, user_id=jorge.id),
                WorkspaceMember(workspace_id=clientes.id, user_id=jorge.id),
                WorkspaceMember(workspace_id=clientes.id, user_id=georgia.id)])
    db.commit()
    return {"crm": crm.id, "clientes": clientes.id, "jorge": jorge.id, "georgia": georgia.id}


def login(email):
    from app.main import app
    client = TestClient(app)
    r = client.post("/api/auth/login", json={"email": email, "password": "clave-segura"})
    assert r.status_code == 200, r.text
    return client


@pytest.fixture
def jorge(setup):
    return login("jorge@sarahi.cl")


@pytest.fixture
def georgia(setup):
    return login("georgia@sarahi.cl")
