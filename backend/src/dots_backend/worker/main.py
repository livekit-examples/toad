from __future__ import annotations

import asyncio
import logging

import asyncpg

from dots_backend.config import Settings, get_settings
from dots_backend.db import SessionLocal
from dots_backend.dispatch import Dispatcher, get_dispatcher
from dots_backend.services import tasks as task_service
from dots_backend.worker import handlers as _handlers  # noqa: F401  (registers task handlers)
from dots_backend.worker.registry import Completed, HandlerContext, get_handler

logger = logging.getLogger(__name__)

POLL_INTERVAL_SECONDS = 2
WATCHDOG_INTERVAL_SECONDS = 30


async def process_one(settings: Settings, dispatcher: Dispatcher) -> bool:
    async with SessionLocal() as session:
        task = await task_service.claim_task(session)
        if task is None:
            await session.commit()
            return False

        # Persist the claim (RUNNING status + incremented attempts) now, so that a
        # rollback triggered by a handler failure below can't revert it.
        await session.commit()

        ctx = HandlerContext(session=session, dispatcher=dispatcher, settings=settings)
        handler = get_handler(task.type)
        try:
            if handler is None:
                raise RuntimeError(f"no handler registered for task type {task.type!r}")
            outcome = await handler(task, ctx)
            if isinstance(outcome, Completed):
                await task_service.set_result(session, task.id, outcome.result)
        except Exception as exc:  # noqa: BLE001 - any handler failure must retry/fail the task, not crash the worker
            logger.exception("handler failed for task %s", task.id)
            await session.rollback()
            await task_service.retry_or_fail(session, task.id, error=str(exc))

        await session.commit()
    return True


async def watchdog_loop(settings: Settings) -> None:
    while True:
        try:
            async with SessionLocal() as session:
                stale = await task_service.fail_stale_running(session)
                await session.commit()
                for task in stale:
                    logger.warning("watchdog failed stale task %s", task.id)
        except Exception:  # noqa: BLE001 - keep the watchdog loop alive across transient DB errors
            logger.exception("watchdog_loop iteration failed")
        await asyncio.sleep(WATCHDOG_INTERVAL_SECONDS)


async def listen_loop(settings: Settings, dispatcher: Dispatcher, concurrency: int = 4) -> None:
    semaphore = asyncio.Semaphore(concurrency)

    async def drain() -> None:
        async with semaphore:
            while await process_one(settings, dispatcher):
                pass

    async def drain_and_log() -> None:
        try:
            await drain()
        except Exception:  # noqa: BLE001 - this runs as a fire-and-forget task
            logger.exception("drain() failed in task_queued listener")

    raw_dsn = settings.database_url.replace("postgresql+asyncpg://", "postgresql://")
    conn = await asyncpg.connect(dsn=raw_dsn)
    await conn.add_listener("task_queued", lambda *_args: asyncio.ensure_future(drain_and_log()))
    try:
        while True:
            try:
                await drain()
            except Exception:  # noqa: BLE001 - keep the listen loop alive across transient DB errors
                logger.exception("listen_loop iteration failed")
            await asyncio.sleep(POLL_INTERVAL_SECONDS)
    finally:
        await conn.close()


async def main() -> None:
    logging.basicConfig(level=logging.INFO)
    settings = get_settings()
    dispatcher = get_dispatcher(settings)
    await asyncio.gather(listen_loop(settings, dispatcher), watchdog_loop(settings))


if __name__ == "__main__":
    asyncio.run(main())
