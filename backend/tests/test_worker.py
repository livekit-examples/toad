import uuid
from datetime import datetime, timedelta, timezone

import pytest

from dots_backend.config import get_settings
from dots_backend.db import SessionLocal
from dots_backend.dispatch import FakeDispatcher
from dots_backend.models import Task, User
from dots_backend.services import tasks as task_service
from dots_backend.worker import handlers as _handlers  # noqa: F401
from dots_backend.worker.main import process_one
from dots_backend.worker.registry import _REGISTRY, register


async def _make_user() -> uuid.UUID:
    async with SessionLocal() as session:
        user = User(name="Ada", phone=f"+1555{uuid.uuid4().int % 10_000_000:07d}", timezone="UTC")
        session.add(user)
        await session.commit()
        await session.refresh(user)
        return user.id


PAYLOAD = {
    "businessName": "Luigi's",
    "phone": "+14155552671",
    "dateTime": "2026-10-01T18:00:00-07:00",
    "partySize": 2,
    "reservationName": "Chad",
}


@pytest.mark.asyncio
async def test_process_one_claims_and_dispatches_reservation_call():
    user_id = await _make_user()
    async with SessionLocal() as session:
        task, _ = await task_service.create_task(
            session, user_id=user_id, type_="RESERVATION_CALL", title="t", payload=PAYLOAD,
            callback={}, idempotency_key=str(uuid.uuid4()),
        )
        await session.commit()
        task_id = task.id

    dispatcher = FakeDispatcher()
    claimed = await process_one(get_settings(), dispatcher)
    assert claimed is True
    assert len(dispatcher.calls) == 1
    assert dispatcher.calls[0]["agent_name"] == "dot-caller"
    assert dispatcher.calls[0]["room_name"] == f"task-{task_id}"

    async with SessionLocal() as session:
        task = await task_service.get_task(session, task_id)
    assert task.status == "RUNNING"
    assert task.room_name == f"task-{task_id}"
    assert task.dispatch_id == f"fake-dispatch-task-{task_id}"


@pytest.mark.asyncio
async def test_process_one_returns_false_when_queue_empty():
    dispatcher = FakeDispatcher()
    claimed = await process_one(get_settings(), dispatcher)
    assert claimed is False


@pytest.mark.asyncio
async def test_watchdog_fails_stale_running_task():
    user_id = await _make_user()
    async with SessionLocal() as session:
        task, _ = await task_service.create_task(
            session, user_id=user_id, type_="RESERVATION_CALL", title="t", payload=PAYLOAD,
            callback={}, idempotency_key=str(uuid.uuid4()),
        )
        await session.commit()
        task_id = task.id

    async with SessionLocal() as session:
        await session.execute(
            Task.__table__.update()
            .where(Task.id == task_id)
            .values(status="RUNNING", started_at=datetime.now(timezone.utc) - timedelta(seconds=999))
        )
        await session.commit()

    async with SessionLocal() as session:
        stale = await task_service.fail_stale_running(session)
        await session.commit()

    assert [t.id for t in stale] == [task_id]
    async with SessionLocal() as session:
        task = await task_service.get_task(session, task_id)
    assert task.status == "FAILED"
    assert task.result["outcome"] == "ERROR"


@pytest.mark.asyncio
async def test_process_one_rolls_back_and_retries_when_handler_raises():
    task_type = f"TEST_ALWAYS_FAILS_{uuid.uuid4().hex}"

    async def _always_fails(task, ctx):
        raise RuntimeError("boom")

    register(task_type, _always_fails)
    try:
        user_id = await _make_user()
        async with SessionLocal() as session:
            task, _ = await task_service.create_task(
                session, user_id=user_id, type_=task_type, title="t", payload=PAYLOAD,
                callback={}, idempotency_key=str(uuid.uuid4()),
            )
            await session.commit()
            task_id = task.id

        dispatcher = FakeDispatcher()
        claimed = await process_one(get_settings(), dispatcher)
        assert claimed is True

        async with SessionLocal() as session:
            task = await task_service.get_task(session, task_id)
            events = await task_service.list_events(session, task_id)

        assert task.status == "QUEUED"
        assert task.attempts == 1
        assert any(e.kind == "ERROR" for e in events)
    finally:
        _REGISTRY.pop(task_type, None)
