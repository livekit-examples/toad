import uuid

import pytest
from httpx import ASGITransport, AsyncClient

from dots_backend.config import get_settings
from dots_backend.db import SessionLocal
from dots_backend.main import app
from dots_backend.models import User

AUTH = {"Authorization": f"Bearer {get_settings().agent_api_key}"}

PAYLOAD = {
    "businessName": "Luigi's",
    "phone": "+14155552671",
    "dateTime": "2026-10-01T18:00:00-07:00",
    "partySize": 2,
    "reservationName": "Chad",
}


async def _make_user() -> str:
    async with SessionLocal() as session:
        user = User(name="Ada", phone=f"+1555{uuid.uuid4().int % 10_000_000:07d}", timezone="UTC")
        session.add(user)
        await session.commit()
        await session.refresh(user)
        return str(user.id)


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.mark.asyncio
async def test_create_task_requires_idempotency_key_header(client):
    user_id = await _make_user()
    resp = await client.post(
        "/agent/tasks",
        json={"userId": user_id, "type": "RESERVATION_CALL", "title": "t", "payload": PAYLOAD},
        headers=AUTH,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_task_rejects_missing_auth(client):
    user_id = await _make_user()
    resp = await client.post(
        "/agent/tasks",
        json={"userId": user_id, "type": "RESERVATION_CALL", "title": "t", "payload": PAYLOAD},
        headers={"Idempotency-Key": str(uuid.uuid4())},
    )
    assert resp.status_code in (401, 422)


@pytest.mark.asyncio
async def test_create_task_then_replay_key_returns_same_task(client):
    user_id = await _make_user()
    key = str(uuid.uuid4())
    headers = {**AUTH, "Idempotency-Key": key}
    body = {"userId": user_id, "type": "RESERVATION_CALL", "title": "t", "payload": PAYLOAD}

    resp1 = await client.post("/agent/tasks", json=body, headers=headers)
    assert resp1.status_code == 201
    task_id = resp1.json()["task"]["id"]

    resp2 = await client.post("/agent/tasks", json=body, headers=headers)
    assert resp2.status_code == 200
    assert resp2.json()["task"]["id"] == task_id


@pytest.mark.asyncio
async def test_get_task_returns_task_and_events(client):
    user_id = await _make_user()
    headers = {**AUTH, "Idempotency-Key": str(uuid.uuid4())}
    body = {"userId": user_id, "type": "RESERVATION_CALL", "title": "t", "payload": PAYLOAD}
    created = await client.post("/agent/tasks", json=body, headers=headers)
    task_id = created.json()["task"]["id"]

    resp = await client.get(f"/agent/tasks/{task_id}", headers=AUTH)
    assert resp.status_code == 200
    data = resp.json()
    assert data["task"]["id"] == task_id
    assert any(e["kind"] == "STATUS_CHANGED" for e in data["events"])


@pytest.mark.asyncio
async def test_cancel_then_cancel_again_returns_409(client):
    user_id = await _make_user()
    headers = {**AUTH, "Idempotency-Key": str(uuid.uuid4())}
    body = {"userId": user_id, "type": "RESERVATION_CALL", "title": "t", "payload": PAYLOAD}
    created = await client.post("/agent/tasks", json=body, headers=headers)
    task_id = created.json()["task"]["id"]

    resp1 = await client.post(f"/agent/tasks/{task_id}/cancel", headers=AUTH)
    assert resp1.status_code == 200
    assert resp1.json()["task"]["status"] == "CANCELED"

    resp2 = await client.post(f"/agent/tasks/{task_id}/cancel", headers=AUTH)
    assert resp2.status_code == 409


@pytest.mark.asyncio
async def test_post_result_twice_second_is_409(client):
    user_id = await _make_user()
    headers = {**AUTH, "Idempotency-Key": str(uuid.uuid4())}
    body = {"userId": user_id, "type": "RESERVATION_CALL", "title": "t", "payload": PAYLOAD}
    created = await client.post("/agent/tasks", json=body, headers=headers)
    task_id = created.json()["task"]["id"]

    result_body = {"result": {"outcome": "CONFIRMED", "summary": "Booked."}}
    resp1 = await client.post(f"/agent/tasks/{task_id}/result", json=result_body, headers=AUTH)
    assert resp1.status_code == 200
    assert resp1.json()["task"]["status"] == "SUCCEEDED"

    resp2 = await client.post(f"/agent/tasks/{task_id}/result", json=result_body, headers=AUTH)
    assert resp2.status_code == 409


@pytest.mark.asyncio
async def test_user_context_and_by_phone_and_404(client):
    async with SessionLocal() as session:
        user = User(name="Ada", phone="+15557778888", timezone="UTC")
        session.add(user)
        await session.commit()
        await session.refresh(user)
        user_id = str(user.id)

    resp = await client.get(f"/agent/users/{user_id}/context", headers=AUTH)
    assert resp.status_code == 200
    assert resp.json()["user"]["phone"] == "+15557778888"

    resp_by_phone = await client.get("/agent/users/by-phone/+15557778888", headers=AUTH)
    assert resp_by_phone.status_code == 200
    assert resp_by_phone.json()["user"]["id"] == user_id

    resp_404 = await client.get("/agent/users/by-phone/+19998887777", headers=AUTH)
    assert resp_404.status_code == 404


@pytest.mark.asyncio
async def test_create_memory(client):
    user_id = await _make_user()
    resp = await client.post(
        f"/agent/users/{user_id}/memories", json={"text": "Prefers window seats"}, headers=AUTH
    )
    assert resp.status_code == 201
    assert resp.json()["text"] == "Prefers window seats"
