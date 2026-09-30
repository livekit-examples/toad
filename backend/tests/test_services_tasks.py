import asyncio
import uuid

import pytest

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
        # retry_or_fail schedules run_after with exponential backoff
        # (2**attempts seconds); claim_task's queue query only picks up rows
        # whose run_after has passed, so the next iteration's claim needs to
        # wait out that backoff before it can reclaim this task.
        await asyncio.sleep(2**task.attempts + 0.2)

    assert task.status == "FAILED"
    assert task.error == "boom"
