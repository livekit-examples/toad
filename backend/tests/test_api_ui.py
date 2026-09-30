import uuid

import pytest
from httpx import ASGITransport, AsyncClient

from dots_backend.db import SessionLocal
from dots_backend.main import app
from dots_backend.models import User
from dots_backend.services import tasks as task_service

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
async def test_get_and_patch_me(client):
    user_id = await _make_user()
    headers = {"X-User-Id": user_id}

    resp = await client.get("/api/me", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["user"]["id"] == user_id

    resp2 = await client.patch("/api/me", json={"name": "Ada Lovelace"}, headers=headers)
    assert resp2.status_code == 200
    assert resp2.json()["user"]["name"] == "Ada Lovelace"


@pytest.mark.asyncio
async def test_list_tasks_filters_by_status(client):
    user_id = await _make_user()
    headers = {"X-User-Id": user_id}

    async with SessionLocal() as session:
        task, _ = await task_service.create_task(
            session, user_id=uuid.UUID(user_id), type_="RESERVATION_CALL", title="t",
            payload=PAYLOAD, callback={}, idempotency_key=str(uuid.uuid4()),
        )
        await session.commit()
        task_id = str(task.id)

    active = await client.get("/api/tasks", params={"status": "active"}, headers=headers)
    assert active.status_code == 200
    assert any(t["id"] == task_id for t in active.json()["tasks"])

    done = await client.get("/api/tasks", params={"status": "done"}, headers=headers)
    assert all(t["id"] != task_id for t in done.json()["tasks"])


@pytest.mark.asyncio
async def test_list_tasks_updated_since_filters_out_old_tasks(client):
    user_id = await _make_user()
    headers = {"X-User-Id": user_id}

    async with SessionLocal() as session:
        await task_service.create_task(
            session, user_id=uuid.UUID(user_id), type_="RESERVATION_CALL", title="t",
            payload=PAYLOAD, callback={}, idempotency_key=str(uuid.uuid4()),
        )
        await session.commit()

    from datetime import datetime, timedelta, timezone

    future = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    resp = await client.get(
        "/api/tasks", params={"status": "all", "updatedSince": future}, headers=headers
    )
    assert resp.json()["tasks"] == []


@pytest.mark.asyncio
async def test_cancel_task_via_ui(client):
    user_id = await _make_user()
    async with SessionLocal() as session:
        task, _ = await task_service.create_task(
            session, user_id=uuid.UUID(user_id), type_="RESERVATION_CALL", title="t",
            payload=PAYLOAD, callback={}, idempotency_key=str(uuid.uuid4()),
        )
        await session.commit()
        task_id = str(task.id)

    resp = await client.post(f"/api/tasks/{task_id}/cancel", headers={"X-User-Id": user_id})
    assert resp.status_code == 200
    assert resp.json()["task"]["status"] == "CANCELED"
