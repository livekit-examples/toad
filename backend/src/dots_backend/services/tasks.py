from __future__ import annotations

import json
from datetime import datetime, timedelta
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from dots_backend.models import Task, TaskEvent

WATCHDOG_STALE_AFTER = timedelta(seconds=240)

_SUCCESS_OUTCOMES = {"CONFIRMED", "ALTERNATIVE_OFFERED"}

_STATUS_GROUPS = {
    "active": ("QUEUED", "RUNNING"),
    "done": ("SUCCEEDED", "FAILED", "CANCELED"),
}


class TaskResultConflict(Exception):
    pass


class TaskAlreadyFinal(Exception):
    pass


async def create_task(
    session: AsyncSession,
    *,
    user_id: UUID,
    type_: str,
    title: str,
    payload: dict,
    callback: dict,
    idempotency_key: str,
) -> tuple[Task, bool]:
    existing = await session.execute(
        select(Task).where(Task.user_id == user_id, Task.idempotency_key == idempotency_key)
    )
    found = existing.scalar_one_or_none()
    if found is not None:
        return found, False

    task = Task(
        user_id=user_id,
        type=type_,
        title=title,
        payload=payload,
        callback=callback,
        idempotency_key=idempotency_key,
    )
    try:
        async with session.begin_nested():
            session.add(task)
            await session.flush()
    except IntegrityError:
        existing = await session.execute(
            select(Task).where(Task.user_id == user_id, Task.idempotency_key == idempotency_key)
        )
        return existing.scalar_one(), False

    await session.execute(text("NOTIFY task_queued"))
    await append_event(session, task.id, "STATUS_CHANGED", "Task created as QUEUED")
    return task, True


async def claim_task(session: AsyncSession) -> Task | None:
    result = await session.execute(
        text(
            """
            UPDATE tasks
            SET status = 'RUNNING', started_at = now(), updated_at = now(), attempts = attempts + 1
            WHERE id = (
                SELECT id FROM tasks
                WHERE status = 'QUEUED' AND run_after <= now()
                ORDER BY created_at
                FOR UPDATE SKIP LOCKED
                LIMIT 1
            )
            RETURNING id
            """
        )
    )
    row = result.first()
    if row is None:
        return None

    task = await session.get(Task, row.id, populate_existing=True)
    assert task is not None
    await append_event(session, task.id, "STATUS_CHANGED", "Task claimed, now RUNNING")
    return task


async def append_event(
    session: AsyncSession, task_id: UUID, kind: str, message: str, data: dict | None = None
) -> TaskEvent:
    event = TaskEvent(task_id=task_id, kind=kind, message=message, data=data)
    session.add(event)
    await session.flush()
    return event


async def set_result(session: AsyncSession, task_id: UUID, result: dict) -> Task:
    outcome = result.get("outcome")
    new_status = "SUCCEEDED" if outcome in _SUCCESS_OUTCOMES else "FAILED"
    sql_result = await session.execute(
        text(
            """
            UPDATE tasks
            SET result = (:result)::jsonb, status = :status, finished_at = now(), updated_at = now()
            WHERE id = :task_id AND result IS NULL AND status IN ('QUEUED', 'RUNNING')
            RETURNING id
            """
        ),
        {"result": _as_jsonb(result), "status": new_status, "task_id": task_id},
    )
    if sql_result.first() is None:
        raise TaskResultConflict(f"task {task_id} already has a result or is in a final state")

    task = await session.get(Task, task_id, populate_existing=True)
    assert task is not None
    await append_event(session, task_id, "STATUS_CHANGED", f"Task finished as {new_status}")
    return task


async def cancel_task(session: AsyncSession, task_id: UUID) -> Task:
    sql_result = await session.execute(
        text(
            """
            UPDATE tasks
            SET status = 'CANCELED', finished_at = now(), updated_at = now()
            WHERE id = :task_id AND status IN ('QUEUED', 'RUNNING')
            RETURNING id
            """
        ),
        {"task_id": task_id},
    )
    if sql_result.first() is None:
        raise TaskAlreadyFinal(f"task {task_id} is already in a final state")

    task = await session.get(Task, task_id, populate_existing=True)
    assert task is not None
    await append_event(session, task_id, "STATUS_CHANGED", "Task canceled")
    return task


async def set_dispatch_info(session: AsyncSession, task_id: UUID, *, room_name: str, dispatch_id: str) -> Task:
    task = await session.get(Task, task_id)
    assert task is not None
    task.room_name = room_name
    task.dispatch_id = dispatch_id
    task.updated_at = datetime.now(tz=task.created_at.tzinfo)
    await session.flush()
    return task


async def retry_or_fail(session: AsyncSession, task_id: UUID, *, error: str) -> Task:
    task = await session.get(Task, task_id)
    assert task is not None

    if task.attempts < 3:
        backoff_seconds = 2**task.attempts
        await session.execute(
            text(
                """
                UPDATE tasks
                SET status = 'QUEUED', run_after = now() + make_interval(secs => :backoff), updated_at = now()
                WHERE id = :task_id
                """
            ),
            {"backoff": backoff_seconds, "task_id": task_id},
        )
        await append_event(session, task_id, "ERROR", error)
        await append_event(
            session,
            task_id,
            "STATUS_CHANGED",
            f"Task requeued for retry (attempt {task.attempts})",
        )
    else:
        await session.execute(
            text(
                """
                UPDATE tasks
                SET status = 'FAILED', error = :error, finished_at = now(), updated_at = now()
                WHERE id = :task_id
                """
            ),
            {"error": error, "task_id": task_id},
        )
        await append_event(session, task_id, "ERROR", error)
        await append_event(session, task_id, "STATUS_CHANGED", "Task failed after exhausting retries")

    # The UPDATE above was issued as raw SQL, which bypasses the ORM's unit of
    # work: the `task` object fetched at the top of this function is already
    # in the session's identity map, so a plain session.get() below would
    # return that stale (pre-update) instance instead of querying again.
    # populate_existing=True forces a re-query that overwrites the cached
    # instance's attributes with the row's current state.
    refreshed = await session.get(Task, task_id, populate_existing=True)
    assert refreshed is not None
    return refreshed


async def fail_stale_running(session: AsyncSession) -> list[Task]:
    sql_result = await session.execute(
        text(
            """
            UPDATE tasks
            SET status = 'FAILED',
                result = (:result)::jsonb,
                error = 'watchdog: task exceeded max duration',
                finished_at = now(),
                updated_at = now()
            WHERE status = 'RUNNING' AND started_at < now() - make_interval(secs => :stale_after)
            RETURNING id
            """
        ),
        {
            "result": _as_jsonb({"outcome": "ERROR", "summary": "Timed out waiting for a result."}),
            "stale_after": WATCHDOG_STALE_AFTER.total_seconds(),
        },
    )
    ids = [row.id for row in sql_result.fetchall()]
    tasks = []
    for task_id in ids:
        await append_event(session, task_id, "ERROR", "Watchdog: task exceeded max duration")
        await append_event(session, task_id, "STATUS_CHANGED", "Task failed by watchdog")
        task = await session.get(Task, task_id, populate_existing=True)
        assert task is not None
        tasks.append(task)
    return tasks


async def get_task(session: AsyncSession, task_id: UUID) -> Task | None:
    return await session.get(Task, task_id)


async def list_events(session: AsyncSession, task_id: UUID) -> list[TaskEvent]:
    result = await session.execute(
        select(TaskEvent).where(TaskEvent.task_id == task_id).order_by(TaskEvent.created_at)
    )
    return list(result.scalars())


async def list_tasks_for_user(
    session: AsyncSession,
    user_id: UUID,
    *,
    status_filter: str | None = None,
    updated_since: datetime | None = None,
    limit: int | None = None,
) -> list[Task]:
    query = select(Task).where(Task.user_id == user_id)
    if status_filter and status_filter in _STATUS_GROUPS:
        query = query.where(Task.status.in_(_STATUS_GROUPS[status_filter]))
    if updated_since is not None:
        query = query.where(Task.updated_at > updated_since)
    query = query.order_by(Task.created_at.desc())
    if limit is not None:
        query = query.limit(limit)
    result = await session.execute(query)
    return list(result.scalars())


def _as_jsonb(value: dict) -> str:
    return json.dumps(value)
