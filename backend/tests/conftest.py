import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://dots:dots@localhost:5432/dots_test")
os.environ.setdefault("AGENT_API_KEY", "test-agent-key")

import pytest_asyncio
from sqlalchemy import text


@pytest_asyncio.fixture(autouse=True)
async def _clean_task_tables():
    # claim_task() and similar queries operate globally (not scoped to a single
    # test's rows), so a task left QUEUED/RUNNING by one test would otherwise
    # be picked up by another test's claim_task() call. Truncate before each
    # test so every test starts from a known-empty state.
    from dots_backend.db import SessionLocal

    async with SessionLocal() as session:
        await session.execute(text("TRUNCATE TABLE task_events, tasks, users RESTART IDENTITY CASCADE"))
        await session.commit()
    yield
