import asyncio
import uuid

import pytest
from sqlalchemy import text

from dots_backend.db import SessionLocal
from dots_backend.models import User
from dots_backend.services import tasks as task_service


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
async def test_create_task_is_idempotent_on_replayed_key():
    user_id = await _make_user()
    key = str(uuid.uuid4())

    async with SessionLocal() as session:
        task1, created1 = await task_service.create_task(
            session, user_id=user_id, type_="RESERVATION_CALL", title="t", payload=PAYLOAD,
            callback={}, idempotency_key=key,
        )
        await session.commit()

    async with SessionLocal() as session:
        task2, created2 = await task_service.create_task(
            session, user_id=user_id, type_="RESERVATION_CALL", title="t", payload=PAYLOAD,
            callback={}, idempotency_key=key,
        )
        await session.commit()

    assert created1 is True
    assert created2 is False
    assert task1.id == task2.id


@pytest.mark.asyncio
async def test_two_concurrent_claims_exactly_one_wins():
    user_id = await _make_user()
    async with SessionLocal() as session:
        task, _ = await task_service.create_task(
            session, user_id=user_id, type_="RESERVATION_CALL", title="t", payload=PAYLOAD,
            callback={}, idempotency_key=str(uuid.uuid4()),
        )
        await session.commit()
        task_id = task.id

    async def try_claim():
        async with SessionLocal() as session:
            claimed = await task_service.claim_task(session)
            await session.commit()
            return claimed

    results = await asyncio.gather(try_claim(), try_claim())
    claimed_ids = [r.id for r in results if r is not None]
    assert claimed_ids == [task_id]


@pytest.mark.asyncio
async def test_first_result_wins_second_gets_conflict():
    user_id = await _make_user()
    async with SessionLocal() as session:
        task, _ = await task_service.create_task(
            session, user_id=user_id, type_="RESERVATION_CALL", title="t", payload=PAYLOAD,
            callback={}, idempotency_key=str(uuid.uuid4()),
        )
        await session.commit()
        task_id = task.id

    result = {"outcome": "CONFIRMED", "summary": "Booked for 6pm."}
    async with SessionLocal() as session:
        updated = await task_service.set_result(session, task_id, result)
        await session.commit()
    assert updated.status == "SUCCEEDED"

    async with SessionLocal() as session:
        with pytest.raises(task_service.TaskResultConflict):
            await task_service.set_result(session, task_id, result)
            await session.commit()


@pytest.mark.asyncio
async def test_set_result_returns_fresh_task_when_already_loaded_in_same_session():
    # Regression test: set_result issues a raw-SQL UPDATE, so a Task object
    # already loaded into this session's identity map (via get_task here)
    # must not cause the post-update session.get() inside set_result to hand
    # back stale, pre-update data.
    user_id = await _make_user()
    async with SessionLocal() as session:
        task, _ = await task_service.create_task(
            session, user_id=user_id, type_="RESERVATION_CALL", title="t", payload=PAYLOAD,
            callback={}, idempotency_key=str(uuid.uuid4()),
        )
        await session.commit()
        task_id = task.id

    async with SessionLocal() as session:
        preloaded = await task_service.get_task(session, task_id)
        assert preloaded is not None
        assert preloaded.status == "QUEUED"

        result = {"outcome": "CONFIRMED", "summary": "Booked for 6pm."}
        updated = await task_service.set_result(session, task_id, result)
        await session.commit()

        assert updated.status == "SUCCEEDED"
        # Same identity-mapped instance as `preloaded`; it must reflect the
        # update too, not the value it held before set_result ran.
        assert preloaded.status == "SUCCEEDED"


@pytest.mark.asyncio
async def test_cancel_transitions_and_rejects_final_state():
    user_id = await _make_user()
    async with SessionLocal() as session:
        task, _ = await task_service.create_task(
            session, user_id=user_id, type_="RESERVATION_CALL", title="t", payload=PAYLOAD,
            callback={}, idempotency_key=str(uuid.uuid4()),
        )
        await session.commit()
        task_id = task.id

    async with SessionLocal() as session:
        canceled = await task_service.cancel_task(session, task_id)
        await session.commit()
    assert canceled.status == "CANCELED"

    async with SessionLocal() as session:
        with pytest.raises(task_service.TaskAlreadyFinal):
            await task_service.cancel_task(session, task_id)
            await session.commit()


@pytest.mark.asyncio
async def test_retry_or_fail_backs_off_then_fails_after_three_attempts():
    user_id = await _make_user()
    async with SessionLocal() as session:
        task, _ = await task_service.create_task(
            session, user_id=user_id, type_="RESERVATION_CALL", title="t", payload=PAYLOAD,
            callback={}, idempotency_key=str(uuid.uuid4()),
        )
        await session.commit()
        task_id = task.id

    for _ in range(3):
        async with SessionLocal() as session:
            await task_service.claim_task(session)
            await session.commit()
        async with SessionLocal() as session:
            task = await task_service.retry_or_fail(session, task_id, error="boom")
            await session.commit()
        if task.status == "FAILED":
            break
        assert task.status == "QUEUED"
        # retry_or_fail schedules run_after with exponential backoff, and
        # claim_task's queue query only picks up rows whose run_after has
        # passed. Rather than sleeping out the real backoff, reset run_after
        # directly so the next iteration's claim can pick the task back up
        # immediately.
        async with SessionLocal() as session:
            await session.execute(
                text("UPDATE tasks SET run_after = now() WHERE id = :task_id"),
                {"task_id": task_id},
            )
            await session.commit()

    assert task.status == "FAILED"
    assert task.error == "boom"

    async with SessionLocal() as session:
        events = await task_service.list_events(session, task_id)
    requeued_messages = [
        event.message
        for event in events
        if event.kind == "STATUS_CHANGED" and event.message.startswith("Task requeued for retry")
    ]
    assert requeued_messages == [
        "Task requeued for retry (attempt 1)",
        "Task requeued for retry (attempt 2)",
    ]
