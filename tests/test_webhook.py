import asyncio
import hashlib
import hmac
import json
import os

import pytest
from fastapi.testclient import TestClient

from app.database import Base, engine
from app.utils import whatsapp_utils
from main import app


def signed_post(client, body):
    raw = json.dumps(body).encode()
    sig = hmac.new(os.environ["APP_SECRET"].encode(), raw, hashlib.sha256).hexdigest()
    return client.post("/webhook", content=raw, headers={"X-Hub-Signature-256": f"sha256={sig}", "Content-Type": "application/json"})


def message_body(message_id="wamid.1", **message):
    message = message or {"type": "text", "text": {"body": "hola"}}
    return {
        "object": "whatsapp_business_account",
        "entry": [{"changes": [{"value": {
            "contacts": [{"wa_id": "56911111111", "profile": {"name": "Ana"}}],
            "messages": [{"id": message_id, "from": "56911111111", **message}],
        }}]}],
    }


@pytest.fixture(autouse=True)
def db():
    async def reset():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)
    asyncio.run(reset())
    yield


@pytest.fixture
def sent(monkeypatch):
    sent = []

    async def fake_send(payload):
        sent.append(payload)

    async def fake_generate(text, wa_id, name):
        return "**Hola** Ana 【4:0†catalogo】"

    monkeypatch.setattr(whatsapp_utils, "send_message", fake_send)
    monkeypatch.setattr(whatsapp_utils, "generate_response", fake_generate)
    return sent


def test_verify_webhook():
    client = TestClient(app)
    ok = client.get("/webhook", params={"hub.mode": "subscribe", "hub.verify_token": "test-verify", "hub.challenge": "123"})
    assert ok.status_code == 200 and ok.text == "123"
    bad = client.get("/webhook", params={"hub.mode": "subscribe", "hub.verify_token": "x", "hub.challenge": "123"})
    assert bad.status_code == 403


def test_rejects_bad_signature():
    client = TestClient(app)
    r = client.post("/webhook", json=message_body(), headers={"X-Hub-Signature-256": "sha256=bad"})
    assert r.status_code == 403


def test_text_message_is_answered_once(sent):
    client = TestClient(app)
    assert signed_post(client, message_body()).status_code == 200
    assert signed_post(client, message_body()).status_code == 200  # reintento de Meta
    assert len(sent) == 1
    assert sent[0]["to"] == "56911111111"
    assert sent[0]["text"]["body"] == "*Hola* Ana"


def test_status_update_returns_200(sent):
    client = TestClient(app)
    body = {"object": "whatsapp_business_account", "entry": [{"changes": [{"value": {"statuses": [{"status": "read"}]}}]}]}
    assert signed_post(client, body).status_code == 200
    assert sent == []


def test_unsupported_message_type(sent):
    client = TestClient(app)
    assert signed_post(client, message_body(type="image", image={"id": "1"})).status_code == 200
    assert sent[0]["text"]["body"] == whatsapp_utils.UNSUPPORTED_MESSAGE


def test_split_long_text():
    parts = whatsapp_utils.split_text("palabra " * 1000)
    assert len(parts) == 2
    assert all(len(p) <= whatsapp_utils.MAX_WHATSAPP_TEXT for p in parts)


def test_generate_response_reuses_conversation(monkeypatch):
    from types import SimpleNamespace
    from app.services import openai_service

    created, calls = [], []

    async def fake_create_conversation(**kwargs):
        created.append(kwargs)
        return SimpleNamespace(id="conv_1")

    async def fake_create_response(**kwargs):
        calls.append(kwargs)
        return SimpleNamespace(status="completed", output_text="respuesta")

    monkeypatch.setattr(openai_service.client.conversations, "create", fake_create_conversation)
    monkeypatch.setattr(openai_service.client.responses, "create", fake_create_response)

    async def run():
        first = await openai_service.generate_response("hola", "569", "Ana")
        second = await openai_service.generate_response("precio?", "569", "Ana")
        return first, second

    assert asyncio.run(run()) == ("respuesta", "respuesta")
    assert len(created) == 1
    assert [c["conversation"] for c in calls] == ["conv_1", "conv_1"]
