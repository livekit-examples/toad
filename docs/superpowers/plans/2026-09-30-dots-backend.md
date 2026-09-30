# Dots on LiveKit — Python Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Python/FastAPI backend for "Dots on LiveKit" — a voice agent (`dot`) that kicks off long-running work (like calling a restaurant to book a table) via a Postgres-backed task queue, and a worker that dispatches a caller agent (`dot-caller`) through LiveKit to do the work.

**Architecture:** FastAPI app + a separate worker process, sharing one Postgres database (SQLAlchemy async ORM + asyncpg). The `tasks` table IS the queue: a `SKIP LOCKED` claim query plus `LISTEN/NOTIFY` for wake-ups, no pg-boss, no Redis. A `Dispatcher` abstraction (`LiveKitDispatcher` / `FakeDispatcher`) lets the whole flow run and be tested without real LiveKit or SIP.

**Tech Stack:** Python 3.12, uv, FastAPI, SQLAlchemy 2.0 (asyncio) + asyncpg, Alembic, pydantic-settings, livekit-api, pytest + pytest-asyncio + httpx, Postgres 16 via docker compose.

**Spec:** `.context/attachments/BsPLwP/pasted_text_2026-09-30_15-25-16.txt` (the full "Dots on LiveKit — Backend Contracts" doc) and `.context/attachments/DyV6z4/plan.md` (the backend-scoping plan this implementation plan expands — it descopes parts of the contracts doc; see Global Constraints for exactly which parts).

## Global Constraints

- Python 3.12, FastAPI, **Postgres as the only store** — no pg-boss, no Redis, no separate message broker.
- The queue is the `tasks` table: claim via `... FOR UPDATE SKIP LOCKED`, wake-ups via `LISTEN/NOTIFY task_queued` with a 2-second poll as a fallback.
- **No callback dispatch in this plan.** The `callback` field on a task is accepted and stored but never acted on. `callbackStatus` stays `PENDING` forever in this plan's scope. No `POST /agent/tasks/:id/callback-status` endpoint.
- **No SSE (`/api/stream`) in this plan.** The UI polls `GET /api/tasks` instead. This plan adds `updatedAt` on `Task` and an `updatedSince` query param on `GET /api/tasks` to make that polling cheap — a deliberate addition to the contracts doc, to flag to the UI teammate.
- **`ALTERNATIVE_OFFERED` counts as `SUCCEEDED`.** Only `CONFIRMED` and `ALTERNATIVE_OFFERED` map to `SUCCEEDED`; every other `ReservationResult.outcome` maps to `FAILED`.
- All timestamps are `timestamptz` columns and serialize as ISO 8601 with a UTC offset (Pydantic's default `datetime` JSON encoding already does this — do not override it).
- OpenAPI hygiene, because the agent teammate generates a Python client from `/openapi.json`: every API schema uses `alias_generator=to_camel` + `populate_by_name=True` (camelCase on the wire, snake_case in Python); every enum is a `str` subclass; FastAPI's `generate_unique_id_function` is set to the route function's own name, so operation IDs come out as `create_task`, `get_task`, etc., not `create_task_agent_tasks_post`.
- Every `/agent/*` route requires `Authorization: Bearer $AGENT_API_KEY`. Every `/api/*` route requires an `X-User-Id` header (no real auth yet — one seeded demo user).
- `DISPATCH_MODE` env var (`livekit` | `fake`) selects the `Dispatcher` implementation everywhere a dispatch happens (worker's `dot-caller` dispatch, and the session endpoint's `dot` dispatch is a plain LiveKit token grant, not a `Dispatcher` call, so it's unaffected).
- `tasks` has `unique(user_id, idempotency_key)` — this is what makes `POST /agent/tasks` idempotent.
- Before writing any code that calls the `livekit-api` package (agent dispatch, room deletion, access tokens, room configuration), use the `livekit:reading-livekit-docs` skill or the LiveKit Docs MCP tool to confirm the current method names and signatures — they are given below as a starting point from the design doc, not a guarantee, and the design doc itself flags them as unverified.

## Review Focus

1. `POST /agent/tasks` with no `Idempotency-Key` header — the contracts doc requires the header; a request missing it should fail with `422`, not silently create an un-deduplicatable task. (Task 7)
2. Two workers racing to claim the same `QUEUED` task — exactly one must win; the other must see no claimable row, not a duplicate dispatch. (Task 4)
3. `POST /agent/tasks/:id/result` called twice (the caller agent's shutdown-hook safety net racing its normal path) — the second call must return `409`, never silently overwrite the first result. (Task 4)
4. A task stuck `RUNNING` past `maxDurationSec + 60s` (dispatched agent crashed and never posted a result) — the watchdog must fail it so the UI and Dot never wait forever, not leave it running indefinitely. (Task 6)
5. `ReservationPayload` with a non-E.164 phone number or `partySize <= 0` — must be rejected with `422` at the API boundary, not stored and only discovered when the caller agent fails to dial. (Task 3)

---

## File Structure

```
backend/
  pyproject.toml
  docker-compose.yml
  .env.example
  alembic.ini
  alembic/
    env.py
    versions/0001_initial.py
  src/dots_backend/
    __init__.py
    config.py
    db.py
    models.py
    schemas.py
    services/
      __init__.py
      tasks.py
    dispatch.py
    worker/
      __init__.py
      registry.py
      main.py
      handlers/
        __init__.py
        reservation_call.py
    api/
      __init__.py
      deps.py
      agent.py
      ui.py
    main.py
  scripts/
    seed.py
    fake_caller.py
  tests/
    conftest.py
    test_config.py
    test_models.py
    test_schemas.py
    test_dispatch.py
    test_services_tasks.py
    test_worker.py
    test_api_agent.py
    test_api_ui.py
    test_openapi.py
```

---

### Task 1: Project scaffolding, config, and DB session

**Files:**
- Create: `backend/pyproject.toml`
- Create: `backend/docker-compose.yml`
- Create: `backend/.env.example`
- Create: `backend/src/dots_backend/__init__.py`
- Create: `backend/src/dots_backend/config.py`
- Create: `backend/src/dots_backend/db.py`
- Test: `backend/tests/conftest.py`, `backend/tests/test_config.py`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `dots_backend.config.Settings` (fields: `database_url: str`, `agent_api_key: str`, `livekit_url: str = ""`, `livekit_api_key: str = ""`, `livekit_api_secret: str = ""`, `dispatch_mode: str = "fake"`, `caller_agent_name: str = "dot-caller"`, `dot_agent_name: str = "dot"`) and `dots_backend.config.get_settings() -> Settings`; `dots_backend.db.engine`, `dots_backend.db.SessionLocal` (an `async_sessionmaker`), and `async def get_session() -> AsyncGenerator[AsyncSession, None]` (a FastAPI dependency).

- [ ] **Step 1: Create the uv project file**

`backend/pyproject.toml`:
```toml
[project]
name = "dots-backend"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
  "fastapi>=0.115",
  "uvicorn[standard]>=0.34",
  "sqlalchemy[asyncio]>=2.0",
  "asyncpg>=0.30",
  "alembic>=1.14",
  "pydantic-settings>=2.6",
  "livekit-api>=0.8",
]

[dependency-groups]
dev = [
  "pytest>=8.3",
  "pytest-asyncio>=0.24",
  "httpx>=0.27",
]

[tool.pytest.ini_options]
asyncio_mode = "auto"
pythonpath = ["src"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/dots_backend"]
```

- [ ] **Step 2: Create the Postgres compose file**

`backend/docker-compose.yml`:
```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: dots
      POSTGRES_PASSWORD: dots
      POSTGRES_DB: dots
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U dots"]
      interval: 2s
      timeout: 2s
      retries: 20
    volumes:
      - dots_pg_data:/var/lib/postgresql/data

volumes:
  dots_pg_data:
```

Only Postgres is containerized. The API and worker run directly via `uv run` per the Verification section — no api/worker Dockerfiles in this plan.

- [ ] **Step 3: Create the env template**

`backend/.env.example`:
```
DATABASE_URL=postgresql+asyncpg://dots:dots@localhost:5432/dots
AGENT_API_KEY=dev-agent-key
LIVEKIT_URL=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
DISPATCH_MODE=fake
CALLER_AGENT_NAME=dot-caller
DOT_AGENT_NAME=dot
```

- [ ] **Step 4: Create the package skeleton**

`backend/src/dots_backend/__init__.py`: empty file.

- [ ] **Step 5: Write `config.py`**

`backend/src/dots_backend/config.py`:
```python
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    agent_api_key: str
    livekit_url: str = ""
    livekit_api_key: str = ""
    livekit_api_secret: str = ""
    dispatch_mode: str = "fake"
    caller_agent_name: str = "dot-caller"
    dot_agent_name: str = "dot"


@lru_cache
def get_settings() -> Settings:
    return Settings()
```

- [ ] **Step 6: Write `db.py`**

`backend/src/dots_backend/db.py`:
```python
from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from dots_backend.config import get_settings

engine = create_async_engine(get_settings().database_url, pool_pre_ping=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session
```

- [ ] **Step 7: Write the failing test**

`backend/tests/conftest.py`:
```python
import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://dots:dots@localhost:5432/dots_test")
os.environ.setdefault("AGENT_API_KEY", "test-agent-key")
```

`backend/tests/test_config.py`:
```python
from dots_backend.config import get_settings


def test_settings_loads_required_and_defaults():
    settings = get_settings()
    assert settings.database_url.startswith("postgresql+asyncpg://")
    assert settings.agent_api_key == "test-agent-key"
    assert settings.dispatch_mode == "fake"
    assert settings.caller_agent_name == "dot-caller"
    assert settings.dot_agent_name == "dot"
```

- [ ] **Step 8: Install and run**

Run: `cd backend && uv sync && uv run pytest tests/test_config.py -v`
Expected: PASS (no database connection needed — `get_settings()` never touches the DB).

- [ ] **Step 9: Commit**

```bash
cd backend && git add pyproject.toml docker-compose.yml .env.example src/dots_backend/__init__.py src/dots_backend/config.py src/dots_backend/db.py tests/conftest.py tests/test_config.py uv.lock
git commit -m "Scaffold backend project, settings, and async DB session"
```

---

### Task 2: Data models and Alembic migration

**Files:**
- Create: `backend/src/dots_backend/models.py`
- Create: `backend/alembic.ini`, `backend/alembic/env.py`, `backend/alembic/versions/0001_initial.py`
- Test: `backend/tests/test_models.py`

**Interfaces:**
- Consumes: `dots_backend.db.engine` (Task 1).
- Produces: ORM classes `User`, `Memory`, `Task`, `TaskEvent` in `dots_backend.models`, all subclassing `dots_backend.models.Base` (a `DeclarativeBase`). Column names below are load-bearing for every later task's raw SQL and ORM queries: `Task` has `id, user_id, type, status, title, payload, result, callback, callback_status, error, idempotency_key, attempts, run_after, room_name, dispatch_id, created_at, started_at, finished_at, updated_at`. `TaskEvent` has `id, task_id, kind, message, data, created_at`.

- [ ] **Step 1: Write the models**

`backend/src/dots_backend/models.py`:
```python
import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, Index, Integer, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    phone: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    timezone: Mapped[str] = mapped_column(String, nullable=False, server_default="UTC")
    callback_defaults: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb")
    )
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=text("now()")
    )


class Memory(Base):
    __tablename__ = "memories"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    text_: Mapped[str] = mapped_column("text", String, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=text("now()")
    )


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    type: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, server_default="QUEUED")
    title: Mapped[str] = mapped_column(String, nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    result: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    callback: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    callback_status: Mapped[str] = mapped_column(String, nullable=False, server_default="PENDING")
    error: Mapped[str | None] = mapped_column(String, nullable=True)
    idempotency_key: Mapped[str | None] = mapped_column(String, nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    run_after: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=text("now()")
    )
    room_name: Mapped[str | None] = mapped_column(String, nullable=True)
    dispatch_id: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=text("now()")
    )
    started_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=text("now()")
    )

    __table_args__ = (
        UniqueConstraint("user_id", "idempotency_key", name="uq_tasks_user_idempotency"),
        Index("ix_tasks_status_run_after", "status", "run_after"),
    )


class TaskEvent(Base):
    __tablename__ = "task_events"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[str] = mapped_column(String, nullable=False)
    message: Mapped[str] = mapped_column(String, nullable=False)
    data: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=text("now()")
    )

    __table_args__ = (Index("ix_task_events_task_created", "task_id", "created_at"),)
```

`Memory.text_` maps Python attribute `text_` to DB column `text` (avoids shadowing the SQL `text()` import). Every later task that builds a `Memory` reads/writes `.text_`, not `.text`.

- [ ] **Step 2: Initialize Alembic**

Run: `cd backend && uv run alembic init -t async alembic`

Then edit the generated `backend/alembic/env.py`: replace its `target_metadata = None` line and its `run_migrations_offline`/`online` DB URL wiring with:

```python
import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.ext.asyncio import async_engine_from_config

from dots_backend.config import get_settings
from dots_backend.models import Base

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

config.set_main_option("sqlalchemy.url", get_settings().database_url)
target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
```

- [ ] **Step 3: Write the initial migration by hand**

`backend/alembic/versions/0001_initial.py`:
```python
"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-09-30
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")

    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("name", sa.String, nullable=False),
        sa.Column("phone", sa.String, nullable=False, unique=True),
        sa.Column("timezone", sa.String, nullable=False, server_default="UTC"),
        sa.Column("callback_defaults", postgresql.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("now()")),
    )

    op.create_table(
        "memories",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("text", sa.String, nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("now()")),
    )

    op.create_table(
        "tasks",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("type", sa.String, nullable=False),
        sa.Column("status", sa.String, nullable=False, server_default="QUEUED"),
        sa.Column("title", sa.String, nullable=False),
        sa.Column("payload", postgresql.JSONB, nullable=False),
        sa.Column("result", postgresql.JSONB, nullable=True),
        sa.Column("callback", postgresql.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("callback_status", sa.String, nullable=False, server_default="PENDING"),
        sa.Column("error", sa.String, nullable=True),
        sa.Column("idempotency_key", sa.String, nullable=True),
        sa.Column("attempts", sa.Integer, nullable=False, server_default="0"),
        sa.Column("run_after", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("room_name", sa.String, nullable=True),
        sa.Column("dispatch_id", sa.String, nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("started_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("finished_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("user_id", "idempotency_key", name="uq_tasks_user_idempotency"),
    )
    op.create_index("ix_tasks_status_run_after", "tasks", ["status", "run_after"])

    op.create_table(
        "task_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("task_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String, nullable=False),
        sa.Column("message", sa.String, nullable=False),
        sa.Column("data", postgresql.JSONB, nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_task_events_task_created", "task_events", ["task_id", "created_at"])


def downgrade() -> None:
    op.drop_table("task_events")
    op.drop_table("tasks")
    op.drop_table("memories")
    op.drop_table("users")
```

- [ ] **Step 4: Bring up Postgres and run the migration**

Run:
```bash
cd backend
docker compose up -d postgres
until docker compose exec -T postgres pg_isready -U dots; do sleep 1; done
docker compose exec -T postgres psql -U dots -c "CREATE DATABASE dots_test;"
DATABASE_URL=postgresql+asyncpg://dots:dots@localhost:5432/dots uv run alembic upgrade head
DATABASE_URL=postgresql+asyncpg://dots:dots@localhost:5432/dots_test uv run alembic upgrade head
```
Expected: both migrations apply with no errors. (`dots` is the dev database; `dots_test` is what `tests/conftest.py`'s `DATABASE_URL` from Task 1 points at — every later task's tests run against `dots_test`.)

- [ ] **Step 5: Write the failing test**

`backend/tests/test_models.py`:
```python
import pytest
from sqlalchemy import select

from dots_backend.db import SessionLocal
from dots_backend.models import User


@pytest.mark.asyncio
async def test_insert_and_read_user_round_trips_jsonb_default():
    async with SessionLocal() as session:
        user = User(name="Ada", phone="+15550001111", timezone="America/Los_Angeles")
        session.add(user)
        await session.commit()
        await session.refresh(user)

        assert user.callback_defaults == {}
        assert user.created_at is not None

        result = await session.execute(select(User).where(User.phone == "+15550001111"))
        fetched = result.scalar_one()
        assert fetched.id == user.id

        await session.delete(fetched)
        await session.commit()
```

- [ ] **Step 6: Run the test**

Run: `cd backend && uv run pytest tests/test_models.py -v`
Expected: PASS against the `dots_test` database from Step 4.

- [ ] **Step 7: Commit**

```bash
cd backend && git add src/dots_backend/models.py alembic.ini alembic/ tests/test_models.py
git commit -m "Add ORM models and initial Alembic migration"
```

---

### Task 3: Pydantic schemas (the OpenAPI contract)

**Files:**
- Create: `backend/src/dots_backend/schemas.py`
- Test: `backend/tests/test_schemas.py`

**Interfaces:**
- Consumes: nothing beyond the standard library and pydantic (independent of Tasks 1-2).
- Produces: `CamelModel` base; enums `TaskType, TaskStatus, CallbackStatus, TaskEventKind, ReservationOutcome`; `Callback, ReservationPayload, ReservationResult, UserSchema, MemorySchema, TaskSchema, TaskEventSchema`; request/response models `CreateTaskRequest, TaskResponse, TaskWithEventsResponse, PostEventRequest, PostResultRequest, UserContextResponse, CreateMemoryRequest, TaskListResponse, UpdateMeRequest, SessionResponse`. Every later task imports types from here by these exact names.

- [ ] **Step 1: Write the schemas**

`backend/src/dots_backend/schemas.py`:
```python
from __future__ import annotations

import re
from datetime import datetime
from enum import Enum
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)


class TaskType(str, Enum):
    RESERVATION_CALL = "RESERVATION_CALL"


class TaskStatus(str, Enum):
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    CANCELED = "CANCELED"


class CallbackStatus(str, Enum):
    PENDING = "PENDING"
    IN_PROGRESS = "IN_PROGRESS"
    DELIVERED = "DELIVERED"
    SKIPPED = "SKIPPED"
    FAILED = "FAILED"


class TaskEventKind(str, Enum):
    STATUS_CHANGED = "STATUS_CHANGED"
    CALL_DIALING = "CALL_DIALING"
    CALL_CONNECTED = "CALL_CONNECTED"
    TRANSCRIPT = "TRANSCRIPT"
    NOTE = "NOTE"
    CALL_ENDED = "CALL_ENDED"
    CALLBACK_STARTED = "CALLBACK_STARTED"
    CALLBACK_DELIVERED = "CALLBACK_DELIVERED"
    ERROR = "ERROR"


class ReservationOutcome(str, Enum):
    CONFIRMED = "CONFIRMED"
    ALTERNATIVE_OFFERED = "ALTERNATIVE_OFFERED"
    UNAVAILABLE = "UNAVAILABLE"
    NO_ANSWER = "NO_ANSWER"
    VOICEMAIL = "VOICEMAIL"
    ERROR = "ERROR"


_E164 = re.compile(r"^\+[1-9]\d{1,14}$")


class Callback(CamelModel):
    channel: Literal["CALL", "NONE"] = "NONE"
    when: Literal["ALWAYS", "ON_SUCCESS", "ON_FAILURE"] = "ON_SUCCESS"
    to: str | None = None


class ReservationPayload(CamelModel):
    business_name: str
    phone: str
    date_time: str
    party_size: int = Field(gt=0)
    reservation_name: str
    flexibility_minutes: int | None = None
    notes: str | None = None

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, v: str) -> str:
        if not _E164.match(v):
            raise ValueError("phone must be E.164, e.g. +14155552671")
        return v


class ReservationResult(CamelModel):
    outcome: ReservationOutcome
    confirmed_date_time: str | None = None
    summary: str


class UserSchema(CamelModel):
    id: UUID
    name: str
    phone: str
    timezone: str
    callback_defaults: Callback
    created_at: datetime


class MemorySchema(CamelModel):
    id: UUID
    user_id: UUID
    text: str = Field(validation_alias="text_", serialization_alias="text")
    created_at: datetime


class TaskSchema(CamelModel):
    id: UUID
    user_id: UUID
    type: TaskType
    status: TaskStatus
    title: str
    payload: ReservationPayload
    result: ReservationResult | None
    callback: Callback
    callback_status: CallbackStatus
    error: str | None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    updated_at: datetime


class TaskEventSchema(CamelModel):
    id: UUID
    task_id: UUID
    kind: TaskEventKind
    message: str
    data: dict[str, Any] | None
    created_at: datetime


class CreateTaskRequest(CamelModel):
    user_id: UUID
    type: TaskType
    title: str
    payload: ReservationPayload
    callback: Callback | None = None


class TaskResponse(CamelModel):
    task: TaskSchema


class TaskWithEventsResponse(CamelModel):
    task: TaskSchema
    events: list[TaskEventSchema]


class TaskListResponse(CamelModel):
    tasks: list[TaskSchema]


class PostEventRequest(CamelModel):
    kind: TaskEventKind
    message: str
    data: dict[str, Any] | None = None


class PostResultRequest(CamelModel):
    result: ReservationResult


class UserContextResponse(CamelModel):
    user: UserSchema
    memories: list[str]
    active_tasks: list[TaskSchema]
    recent_tasks: list[TaskSchema]


class CreateMemoryRequest(CamelModel):
    text: str


class UpdateMeRequest(CamelModel):
    name: str | None = None
    phone: str | None = None
    timezone: str | None = None
    callback_defaults: Callback | None = None


class SessionResponse(CamelModel):
    server_url: str
    participant_token: str
    room_name: str
```

`MemorySchema.text` overrides the `CamelModel` default alias behavior on purpose: the ORM attribute is `text_` (Task 2), but the wire field must be `text`, not `textUnderscore` or similar — `validation_alias`/`serialization_alias` pin it exactly.

- [ ] **Step 2: Write the failing tests**

`backend/tests/test_schemas.py`:
```python
import pytest
from pydantic import ValidationError

from dots_backend.schemas import ReservationPayload, TaskSchema


def test_reservation_payload_accepts_valid_e164_and_camel_case_wire_format():
    payload = ReservationPayload.model_validate(
        {
            "businessName": "Luigi's",
            "phone": "+14155552671",
            "dateTime": "2026-10-01T18:00:00-07:00",
            "partySize": 2,
            "reservationName": "Chad",
        }
    )
    assert payload.business_name == "Luigi's"
    assert payload.model_dump(by_alias=True)["partySize"] == 2


@pytest.mark.parametrize("phone", ["5550001111", "+0155500011", "not-a-phone"])
def test_reservation_payload_rejects_non_e164_phone(phone):
    with pytest.raises(ValidationError):
        ReservationPayload(
            business_name="Luigi's",
            phone=phone,
            date_time="2026-10-01T18:00:00-07:00",
            party_size=2,
            reservation_name="Chad",
        )


def test_reservation_payload_rejects_non_positive_party_size():
    with pytest.raises(ValidationError):
        ReservationPayload(
            business_name="Luigi's",
            phone="+14155552671",
            date_time="2026-10-01T18:00:00-07:00",
            party_size=0,
            reservation_name="Chad",
        )


def test_task_schema_serializes_str_enums_and_camel_case():
    dump = TaskSchema.model_construct(
        id="11111111-1111-1111-1111-111111111111",
        user_id="22222222-2222-2222-2222-222222222222",
        type="RESERVATION_CALL",
        status="QUEUED",
        title="Table for 2",
        payload=ReservationPayload(
            business_name="Luigi's",
            phone="+14155552671",
            date_time="2026-10-01T18:00:00-07:00",
            party_size=2,
            reservation_name="Chad",
        ),
        result=None,
        callback={"channel": "NONE", "when": "ON_SUCCESS", "to": None},
        callback_status="PENDING",
        error=None,
        created_at="2026-09-30T00:00:00+00:00",
        started_at=None,
        finished_at=None,
        updated_at="2026-09-30T00:00:00+00:00",
    ).model_dump(mode="json", by_alias=True)
    assert dump["userId"] == "22222222-2222-2222-2222-222222222222"
    assert dump["callbackStatus"] == "PENDING"
    assert isinstance(dump["status"], str)
```

- [ ] **Step 3: Run the tests**

Run: `cd backend && uv run pytest tests/test_schemas.py -v`
Expected: PASS (pure Pydantic, no DB).

- [ ] **Step 4: Commit**

```bash
cd backend && git add src/dots_backend/schemas.py tests/test_schemas.py
git commit -m "Add Pydantic schemas with camelCase OpenAPI contract"
```

---

### Task 4: Task service — the queue's only state-mutation path

**Files:**
- Create: `backend/src/dots_backend/services/__init__.py`, `backend/src/dots_backend/services/tasks.py`
- Test: `backend/tests/test_services_tasks.py`

**Interfaces:**
- Consumes: `dots_backend.models.Task, TaskEvent, User` (Task 2), `dots_backend.db.SessionLocal` (Task 1).
- Produces (every name here is called verbatim by Tasks 6, 7, 8):
  - `class TaskResultConflict(Exception)`, `class TaskAlreadyFinal(Exception)`
  - `WATCHDOG_STALE_AFTER: timedelta` (= 240 seconds)
  - `async def create_task(session, *, user_id: UUID, type_: str, title: str, payload: dict, callback: dict, idempotency_key: str) -> tuple[Task, bool]` — `bool` is `True` if a new row was inserted, `False` if `idempotency_key` matched an existing row.
  - `async def claim_task(session) -> Task | None`
  - `async def append_event(session, task_id: UUID, kind: str, message: str, data: dict | None = None) -> TaskEvent`
  - `async def set_result(session, task_id: UUID, result: dict) -> Task` — raises `TaskResultConflict` if the task already has a result or is in a final state.
  - `async def cancel_task(session, task_id: UUID) -> Task` — raises `TaskAlreadyFinal` if not `QUEUED`/`RUNNING`.
  - `async def set_dispatch_info(session, task_id: UUID, *, room_name: str, dispatch_id: str) -> Task`
  - `async def retry_or_fail(session, task_id: UUID, *, error: str) -> Task`
  - `async def fail_stale_running(session) -> list[Task]`
  - `async def get_task(session, task_id: UUID) -> Task | None`
  - `async def list_events(session, task_id: UUID) -> list[TaskEvent]`
  - `async def list_tasks_for_user(session, user_id: UUID, *, status_filter: str | None = None, updated_since: datetime | None = None, limit: int | None = None) -> list[Task]` — `status_filter` is one of `"active"` (`QUEUED`/`RUNNING`), `"done"` (`SUCCEEDED`/`FAILED`/`CANCELED`), `"all"`, or `None` (same as `"all"`).

- [ ] **Step 1: Write `services/__init__.py`**

Empty file: `backend/src/dots_backend/services/__init__.py`.

- [ ] **Step 2: Write the service module**

`backend/src/dots_backend/services/tasks.py`:
```python
from __future__ import annotations

import json
from datetime import datetime, timedelta
from uuid import UUID

from sqlalchemy import select, text
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
    session.add(task)
    try:
        await session.flush()
    except Exception:
        await session.rollback()
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

    task = await session.get(Task, row.id)
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

    task = await session.get(Task, task_id)
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

    task = await session.get(Task, task_id)
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

    refreshed = await session.get(Task, task_id)
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
        task = await session.get(Task, task_id)
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
```

`_as_jsonb` serializes the result dict to a JSON string; the `(:result)::jsonb` cast in both statements above is what lets asyncpg bind that string into a `jsonb` column unambiguously.

- [ ] **Step 3: Write the failing tests**

`backend/tests/test_services_tasks.py`:
```python
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

    assert task.status == "FAILED"
    assert task.error == "boom"
```

- [ ] **Step 4: Run the tests**

Run: `cd backend && uv run pytest tests/test_services_tasks.py -v`
Expected: PASS against `dots_test` (started in Task 2 Step 4). If `test_two_concurrent_claims_exactly_one_wins` is flaky, confirm both `try_claim()` calls truly run on separate connections (separate `SessionLocal()` instances, as written) — a shared connection would serialize them and hide the race this test exists to catch.

- [ ] **Step 5: Commit**

```bash
cd backend && git add src/dots_backend/services/ tests/test_services_tasks.py
git commit -m "Add task service: idempotent create, SKIP LOCKED claim, result/cancel/retry state machine"
```

---

### Task 5: Dispatcher abstraction

**Files:**
- Create: `backend/src/dots_backend/dispatch.py`
- Test: `backend/tests/test_dispatch.py`

**Interfaces:**
- Consumes: `dots_backend.config.Settings` (Task 1).
- Produces: `class Dispatcher(Protocol)` with `async def dispatch(self, *, agent_name: str, room_name: str, metadata: dict) -> str`; `class LiveKitDispatcher` and `class FakeDispatcher` implementing it; `def get_dispatcher(settings: Settings) -> Dispatcher`. `FakeDispatcher` additionally exposes `self.calls: list[dict]` (each entry `{"agent_name", "room_name", "metadata"}`) so tests and `worker/handlers/reservation_call.py` callers can assert on it without mocking.

- [ ] **Step 1: Confirm the LiveKit dispatch API before writing `LiveKitDispatcher`**

Use the `livekit:reading-livekit-docs` skill (or the LiveKit Docs MCP tool directly: `mcp__claude_ai_LiveKit_Docs_MCP__docs_search` / `code_search`) to confirm, for the currently installed `livekit-api` version: the class name for the server API client, the method used to create an explicit agent dispatch, and the request/response field names (agent name, room, metadata, returned dispatch id). The code below is the design doc's best guess, not a verified signature — adjust it to match what the docs show, and note in your report if it differed.

- [ ] **Step 2: Write the dispatcher module**

`backend/src/dots_backend/dispatch.py`:
```python
from __future__ import annotations

import json
import logging
from typing import Protocol

from livekit import api as lk_api

from dots_backend.config import Settings

logger = logging.getLogger(__name__)


class Dispatcher(Protocol):
    async def dispatch(self, *, agent_name: str, room_name: str, metadata: dict) -> str: ...


class LiveKitDispatcher:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    async def dispatch(self, *, agent_name: str, room_name: str, metadata: dict) -> str:
        async with lk_api.LiveKitAPI(
            self._settings.livekit_url,
            self._settings.livekit_api_key,
            self._settings.livekit_api_secret,
        ) as lk:
            dispatch = await lk.agent_dispatch.create_dispatch(
                lk_api.CreateAgentDispatchRequest(
                    agent_name=agent_name,
                    room=room_name,
                    metadata=json.dumps(metadata),
                )
            )
        return dispatch.id


class FakeDispatcher:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    async def dispatch(self, *, agent_name: str, room_name: str, metadata: dict) -> str:
        self.calls.append({"agent_name": agent_name, "room_name": room_name, "metadata": metadata})
        logger.info("fake dispatch agent_name=%s room_name=%s metadata=%s", agent_name, room_name, metadata)
        return f"fake-dispatch-{room_name}"


def get_dispatcher(settings: Settings) -> Dispatcher:
    if settings.dispatch_mode == "livekit":
        return LiveKitDispatcher(settings)
    return FakeDispatcher()
```

- [ ] **Step 3: Write the failing tests**

`backend/tests/test_dispatch.py`:
```python
import pytest

from dots_backend.config import Settings
from dots_backend.dispatch import FakeDispatcher, LiveKitDispatcher, get_dispatcher


@pytest.mark.asyncio
async def test_fake_dispatcher_records_calls_and_returns_an_id():
    dispatcher = FakeDispatcher()
    dispatch_id = await dispatcher.dispatch(
        agent_name="dot-caller", room_name="task-123", metadata={"taskId": "123"}
    )
    assert dispatch_id == "fake-dispatch-task-123"
    assert dispatcher.calls == [
        {"agent_name": "dot-caller", "room_name": "task-123", "metadata": {"taskId": "123"}}
    ]


def test_get_dispatcher_selects_implementation_by_mode():
    fake_settings = Settings(database_url="postgresql+asyncpg://x", agent_api_key="k", dispatch_mode="fake")
    assert isinstance(get_dispatcher(fake_settings), FakeDispatcher)

    livekit_settings = Settings(database_url="postgresql+asyncpg://x", agent_api_key="k", dispatch_mode="livekit")
    assert isinstance(get_dispatcher(livekit_settings), LiveKitDispatcher)
```

- [ ] **Step 4: Run the tests**

Run: `cd backend && uv run pytest tests/test_dispatch.py -v`
Expected: PASS (no real LiveKit credentials needed — `LiveKitDispatcher` is only constructed, never called, in this test).

- [ ] **Step 5: Commit**

```bash
cd backend && git add src/dots_backend/dispatch.py tests/test_dispatch.py
git commit -m "Add Dispatcher protocol with LiveKit and fake implementations"
```

---

### Task 6: Worker — claim loop, reservation-call handler, watchdog

**Files:**
- Create: `backend/src/dots_backend/worker/__init__.py`, `backend/src/dots_backend/worker/registry.py`, `backend/src/dots_backend/worker/handlers/__init__.py`, `backend/src/dots_backend/worker/handlers/reservation_call.py`, `backend/src/dots_backend/worker/main.py`
- Test: `backend/tests/test_worker.py`

**Interfaces:**
- Consumes: `dots_backend.services.tasks` (all functions, Task 4), `dots_backend.dispatch.Dispatcher/get_dispatcher` (Task 5), `dots_backend.models.Task` (Task 2), `dots_backend.db.SessionLocal` (Task 1), `dots_backend.config.get_settings` (Task 1).
- Produces: `worker.registry.Completed(result: dict)`, `worker.registry.Delegated()`, `worker.registry.HandlerContext(session, dispatcher, settings)`, `worker.registry.register(task_type: str, handler)`, `worker.registry.get_handler(task_type: str) -> Handler | None`; `worker.main.process_one(settings, dispatcher) -> bool` (returns `True` if it claimed and ran a task, `False` if the queue was empty — this is what Task 7/8's tests and any manual smoke test call to drive the worker one step at a time without the infinite loop).

- [ ] **Step 1: Write the registry**

`backend/src/dots_backend/worker/__init__.py`: empty file.

`backend/src/dots_backend/worker/registry.py`:
```python
from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, Union

from sqlalchemy.ext.asyncio import AsyncSession

from dots_backend.config import Settings
from dots_backend.dispatch import Dispatcher
from dots_backend.models import Task


@dataclass
class Completed:
    result: dict[str, Any]


@dataclass
class Delegated:
    pass


@dataclass
class HandlerContext:
    session: AsyncSession
    dispatcher: Dispatcher
    settings: Settings


Handler = Callable[[Task, HandlerContext], Awaitable[Union[Completed, Delegated]]]

_REGISTRY: dict[str, Handler] = {}


def register(task_type: str, handler: Handler) -> None:
    _REGISTRY[task_type] = handler


def get_handler(task_type: str) -> Handler | None:
    return _REGISTRY.get(task_type)
```

- [ ] **Step 2: Write the reservation-call handler**

`backend/src/dots_backend/worker/handlers/__init__.py`: empty file.

`backend/src/dots_backend/worker/handlers/reservation_call.py`:
```python
from dots_backend.models import Task
from dots_backend.services import tasks as task_service
from dots_backend.worker.registry import Delegated, HandlerContext, register


async def handle(task: Task, ctx: HandlerContext) -> Delegated:
    room_name = f"task-{task.id}"
    metadata = {
        "taskId": str(task.id),
        "type": task.type,
        "payload": task.payload,
        "to": task.payload["phone"],
        "maxDurationSec": 180,
    }
    dispatch_id = await ctx.dispatcher.dispatch(
        agent_name=ctx.settings.caller_agent_name,
        room_name=room_name,
        metadata=metadata,
    )
    await task_service.set_dispatch_info(ctx.session, task.id, room_name=room_name, dispatch_id=dispatch_id)
    return Delegated()


register("RESERVATION_CALL", handle)
```

Importing this module (which Step 3's `worker/main.py` does) is what populates the registry — there is no separate "wire it up" step.

- [ ] **Step 3: Write the worker loop**

`backend/src/dots_backend/worker/main.py`:
```python
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
            await task_service.retry_or_fail(session, task.id, error=str(exc))

        await session.commit()
    return True


async def watchdog_loop(settings: Settings) -> None:
    while True:
        async with SessionLocal() as session:
            stale = await task_service.fail_stale_running(session)
            await session.commit()
            for task in stale:
                logger.warning("watchdog failed stale task %s", task.id)
        await asyncio.sleep(WATCHDOG_INTERVAL_SECONDS)


async def listen_loop(settings: Settings, dispatcher: Dispatcher, concurrency: int = 4) -> None:
    semaphore = asyncio.Semaphore(concurrency)

    async def drain() -> None:
        async with semaphore:
            while await process_one(settings, dispatcher):
                pass

    raw_dsn = settings.database_url.replace("postgresql+asyncpg://", "postgresql://")
    conn = await asyncpg.connect(dsn=raw_dsn)
    await conn.add_listener("task_queued", lambda *_args: asyncio.ensure_future(drain()))
    try:
        while True:
            await drain()
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
```

- [ ] **Step 4: Write the failing tests**

`backend/tests/test_worker.py`:
```python
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
```

- [ ] **Step 5: Run the tests**

Run: `cd backend && uv run pytest tests/test_worker.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd backend && git add src/dots_backend/worker/ tests/test_worker.py
git commit -m "Add worker claim loop, reservation-call handler, and watchdog"
```

---

### Task 7: Agent API — auth, tasks, users, memories

**Files:**
- Create: `backend/src/dots_backend/api/__init__.py`, `backend/src/dots_backend/api/deps.py`, `backend/src/dots_backend/api/agent.py`
- Test: `backend/tests/test_api_agent.py`

**Interfaces:**
- Consumes: `dots_backend.schemas.*` (Task 3), `dots_backend.services.tasks.*` (Task 4), `dots_backend.models.User, Memory` (Task 2), `dots_backend.db.get_session` (Task 1), `dots_backend.config.get_settings` (Task 1). The cancel route imports `livekit.api` directly (not the Task 5 `Dispatcher` abstraction) for the one-off best-effort room deletion — deleting a room isn't a dispatch.
- Produces: `dots_backend.api.deps.require_agent_auth` (a FastAPI dependency), `dots_backend.api.agent.router: APIRouter` (prefix `/agent`) — the exact router Task 9 mounts in `main.py`.

- [ ] **Step 1: Write the auth dependency**

`backend/src/dots_backend/api/__init__.py`: empty file.

`backend/src/dots_backend/api/deps.py`:
```python
from fastapi import Header, HTTPException, status

from dots_backend.config import get_settings


def require_agent_auth(authorization: str = Header(...)) -> None:
    settings = get_settings()
    if authorization != f"Bearer {settings.agent_api_key}":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid bearer token")


def get_current_user_id(x_user_id: str = Header(...)) -> str:
    return x_user_id
```

- [ ] **Step 2: Write the agent router**

`backend/src/dots_backend/api/agent.py`:
```python
from __future__ import annotations

import contextlib
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from dots_backend.api.deps import require_agent_auth
from dots_backend.config import get_settings
from dots_backend.db import get_session
from dots_backend.models import Memory, User
from dots_backend.schemas import (
    Callback,
    CreateMemoryRequest,
    CreateTaskRequest,
    MemorySchema,
    PostEventRequest,
    PostResultRequest,
    TaskEventSchema,
    TaskResponse,
    TaskSchema,
    TaskWithEventsResponse,
    UserContextResponse,
    UserSchema,
)
from dots_backend.services import tasks as task_service
from dots_backend.services.tasks import TaskAlreadyFinal, TaskResultConflict

router = APIRouter(prefix="/agent", dependencies=[Depends(require_agent_auth)])


@router.post("/tasks", response_model=TaskResponse)
async def create_task(
    body: CreateTaskRequest,
    response: Response,
    idempotency_key: str = Header(..., alias="Idempotency-Key"),
    session: AsyncSession = Depends(get_session),
):
    callback = body.callback or Callback()
    task, created = await task_service.create_task(
        session,
        user_id=body.user_id,
        type_=body.type.value,
        title=body.title,
        payload=body.payload.model_dump(mode="json", by_alias=True),
        callback=callback.model_dump(mode="json", by_alias=True),
        idempotency_key=idempotency_key,
    )
    await session.commit()
    response.status_code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
    return TaskResponse(task=TaskSchema.model_validate(task))


@router.get("/tasks/{task_id}", response_model=TaskWithEventsResponse)
async def get_task(task_id: UUID, session: AsyncSession = Depends(get_session)):
    task = await task_service.get_task(session, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")
    events = await task_service.list_events(session, task_id)
    return TaskWithEventsResponse(
        task=TaskSchema.model_validate(task),
        events=[TaskEventSchema.model_validate(e) for e in events],
    )


@router.post("/tasks/{task_id}/cancel", response_model=TaskResponse)
async def cancel_task(task_id: UUID, session: AsyncSession = Depends(get_session)):
    try:
        task = await task_service.cancel_task(session, task_id)
    except TaskAlreadyFinal as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    await session.commit()

    settings = get_settings()
    if task.room_name and settings.dispatch_mode == "livekit":
        from livekit import api as lk_api

        async with lk_api.LiveKitAPI(
            settings.livekit_url, settings.livekit_api_key, settings.livekit_api_secret
        ) as lk:
            with contextlib.suppress(Exception):
                await lk.room.delete_room(lk_api.DeleteRoomRequest(room=task.room_name))

    return TaskResponse(task=TaskSchema.model_validate(task))


@router.post("/tasks/{task_id}/events", status_code=status.HTTP_204_NO_CONTENT)
async def create_task_event(
    task_id: UUID, body: PostEventRequest, session: AsyncSession = Depends(get_session)
):
    await task_service.append_event(session, task_id, body.kind.value, body.message, body.data)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/tasks/{task_id}/result", response_model=TaskResponse)
async def post_task_result(
    task_id: UUID, body: PostResultRequest, session: AsyncSession = Depends(get_session)
):
    try:
        task = await task_service.set_result(
            session, task_id, body.result.model_dump(mode="json", by_alias=True)
        )
    except TaskResultConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    await session.commit()
    return TaskResponse(task=TaskSchema.model_validate(task))


async def _build_context(session: AsyncSession, user: User) -> UserContextResponse:
    memories_result = await session.execute(
        select(Memory.text_).where(Memory.user_id == user.id).order_by(Memory.created_at.desc())
    )
    memories = list(memories_result.scalars())
    active = await task_service.list_tasks_for_user(session, user.id, status_filter="active")
    recent = await task_service.list_tasks_for_user(session, user.id, status_filter="done", limit=10)
    return UserContextResponse(
        user=UserSchema.model_validate(user),
        memories=memories,
        active_tasks=[TaskSchema.model_validate(t) for t in active],
        recent_tasks=[TaskSchema.model_validate(t) for t in recent],
    )


@router.get("/users/{user_id}/context", response_model=UserContextResponse)
async def get_user_context(user_id: UUID, session: AsyncSession = Depends(get_session)):
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="user not found")
    return await _build_context(session, user)


@router.get("/users/by-phone/{phone}", response_model=UserContextResponse)
async def get_user_by_phone(phone: str, session: AsyncSession = Depends(get_session)):
    result = await session.execute(select(User).where(User.phone == phone))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="user not found")
    return await _build_context(session, user)


@router.post("/users/{user_id}/memories", status_code=status.HTTP_201_CREATED, response_model=MemorySchema)
async def create_memory(
    user_id: UUID, body: CreateMemoryRequest, session: AsyncSession = Depends(get_session)
):
    memory = Memory(user_id=user_id, text_=body.text)
    session.add(memory)
    await session.commit()
    await session.refresh(memory)
    return MemorySchema.model_validate(memory)
```

Note the `phone` path parameter in `get_user_by_phone` (`/users/by-phone/{phone}`): a leading `+` in a path segment is valid in an HTTP path (unlike in a query string, where `+` decodes to a space), so no URL-decoding workaround is needed here — verify this holds in Step 4's test by using a real `+`-prefixed phone number.

- [ ] **Step 3: Write the failing tests**

`backend/tests/test_api_agent.py`:
```python
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
```

- [ ] **Step 4: Run the tests**

Run: `cd backend && uv run pytest tests/test_api_agent.py -v`
Expected: PASS. (`dots_backend.main` does not exist until Task 9 — if this task is implemented before Task 9 in a different order than written, add a minimal temporary `main.py` that mounts only `agent.router`; otherwise skip straight to Task 9 wiring and return here. As planned, Task 9 comes after this task, so `main.py` must be stubbed here: create it now with just `app = FastAPI(); app.include_router(router)` and let Task 9 replace it with the full version including OpenAPI hygiene and the UI router.)

- [ ] **Step 5: Commit**

```bash
cd backend && git add src/dots_backend/api/ src/dots_backend/main.py tests/test_api_agent.py
git commit -m "Add /agent/* routes: tasks, cancel, events, result, user context, memories"
```

---

### Task 8: UI API — me, tasks polling, session token

**Files:**
- Create: `backend/src/dots_backend/api/ui.py`
- Test: `backend/tests/test_api_ui.py`

**Interfaces:**
- Consumes: `dots_backend.schemas.*` (Task 3), `dots_backend.services.tasks.*` (Task 4), `dots_backend.api.deps.get_current_user_id` (Task 7), `dots_backend.config.get_settings` (Task 1).
- Produces: `dots_backend.api.ui.router: APIRouter` (prefix `/api`) — mounted by Task 9's `main.py` alongside `agent.router`.

- [ ] **Step 1: Confirm the LiveKit token/room-config API before writing `/api/session`**

As in Task 5 Step 1, confirm via the LiveKit docs skill/MCP tool the current `AccessToken` builder methods and the shape of `RoomConfiguration`/`RoomAgentDispatch` for the installed `livekit-api` version. The code below is a best guess from the design doc.

- [ ] **Step 2: Write the UI router**

`backend/src/dots_backend/api/ui.py`:
```python
from __future__ import annotations

import json
import uuid
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from livekit import api as lk_api
from sqlalchemy.ext.asyncio import AsyncSession

from dots_backend.api.deps import get_current_user_id
from dots_backend.config import get_settings
from dots_backend.db import get_session
from dots_backend.models import User
from dots_backend.schemas import (
    SessionResponse,
    TaskListResponse,
    TaskResponse,
    TaskSchema,
    TaskWithEventsResponse,
    TaskEventSchema,
    UpdateMeRequest,
    UserSchema,
)
from dots_backend.services import tasks as task_service
from dots_backend.services.tasks import TaskAlreadyFinal

router = APIRouter(prefix="/api")


class MeResponse(UserSchema):
    pass


@router.get("/me")
async def get_me(
    user_id: str = Depends(get_current_user_id), session: AsyncSession = Depends(get_session)
):
    user = await session.get(User, UUID(user_id))
    if user is None:
        raise HTTPException(status_code=404, detail="user not found")
    return {"user": UserSchema.model_validate(user)}


@router.patch("/me")
async def update_me(
    body: UpdateMeRequest,
    user_id: str = Depends(get_current_user_id),
    session: AsyncSession = Depends(get_session),
):
    user = await session.get(User, UUID(user_id))
    if user is None:
        raise HTTPException(status_code=404, detail="user not found")
    if body.name is not None:
        user.name = body.name
    if body.phone is not None:
        user.phone = body.phone
    if body.timezone is not None:
        user.timezone = body.timezone
    if body.callback_defaults is not None:
        user.callback_defaults = body.callback_defaults.model_dump(mode="json", by_alias=True)
    await session.commit()
    await session.refresh(user)
    return {"user": UserSchema.model_validate(user)}


@router.post("/session", response_model=SessionResponse)
async def create_session(user_id: str = Depends(get_current_user_id)):
    settings = get_settings()
    room_name = f"session-{uuid.uuid4()}"
    token = (
        lk_api.AccessToken(settings.livekit_api_key, settings.livekit_api_secret)
        .with_identity(user_id)
        .with_grants(lk_api.VideoGrants(room_join=True, room=room_name))
        .with_room_config(
            lk_api.RoomConfiguration(
                agents=[
                    lk_api.RoomAgentDispatch(
                        agent_name=settings.dot_agent_name,
                        metadata=json.dumps({"mode": "SESSION", "userId": user_id}),
                    )
                ]
            )
        )
    )
    return SessionResponse(server_url=settings.livekit_url, participant_token=token.to_jwt(), room_name=room_name)


@router.get("/tasks", response_model=TaskListResponse)
async def list_tasks(
    status: str = Query("active", pattern="^(active|done|all)$"),
    updated_since: datetime | None = Query(None, alias="updatedSince"),
    user_id: str = Depends(get_current_user_id),
    session: AsyncSession = Depends(get_session),
):
    tasks = await task_service.list_tasks_for_user(
        session, UUID(user_id), status_filter=status, updated_since=updated_since
    )
    return TaskListResponse(tasks=[TaskSchema.model_validate(t) for t in tasks])


@router.get("/tasks/{task_id}", response_model=TaskWithEventsResponse)
async def get_task(task_id: UUID, session: AsyncSession = Depends(get_session)):
    task = await task_service.get_task(session, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")
    events = await task_service.list_events(session, task_id)
    return TaskWithEventsResponse(
        task=TaskSchema.model_validate(task),
        events=[TaskEventSchema.model_validate(e) for e in events],
    )


@router.post("/tasks/{task_id}/cancel", response_model=TaskResponse)
async def cancel_task(task_id: UUID, session: AsyncSession = Depends(get_session)):
    try:
        task = await task_service.cancel_task(session, task_id)
    except TaskAlreadyFinal as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    await session.commit()
    return TaskResponse(task=TaskSchema.model_validate(task))
```

Drop the unused `MeResponse` class — it was scaffolding that turned out unnecessary once `get_me` returns a plain dict; delete it before running Step 3.

- [ ] **Step 3: Write the failing tests**

`backend/tests/test_api_ui.py`:
```python
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
```

- [ ] **Step 4: Update `main.py` to mount both routers**

Edit `backend/src/dots_backend/main.py` (the Task 7 stub) to add:
```python
from dots_backend.api.ui import router as ui_router

app.include_router(ui_router)
```

- [ ] **Step 5: Run the tests**

Run: `cd backend && uv run pytest tests/test_api_ui.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd backend && git add src/dots_backend/api/ui.py src/dots_backend/main.py tests/test_api_ui.py
git commit -m "Add /api/* routes: me, session token, task polling with updatedSince"
```

---

### Task 9: App wiring, OpenAPI hygiene, seed/fake-caller scripts

**Files:**
- Modify: `backend/src/dots_backend/main.py` (replace the Task 7 stub)
- Create: `backend/scripts/seed.py`, `backend/scripts/fake_caller.py`
- Test: `backend/tests/test_openapi.py`

**Interfaces:**
- Consumes: `dots_backend.api.agent.router`, `dots_backend.api.ui.router` (Tasks 7-8), `dots_backend.services.tasks` (Task 4), `dots_backend.models.User` (Task 2).
- Produces: the final `dots_backend.main.app`, and two standalone scripts used only for manual verification (not imported by any other module).

- [ ] **Step 1: Write the final `main.py`**

`backend/src/dots_backend/main.py`:
```python
from fastapi import FastAPI
from fastapi.routing import APIRoute

from dots_backend.api.agent import router as agent_router
from dots_backend.api.ui import router as ui_router


def _operation_id(route: APIRoute) -> str:
    return route.name


app = FastAPI(title="Dots Backend", generate_unique_id_function=_operation_id)
app.include_router(agent_router)
app.include_router(ui_router)
```

- [ ] **Step 2: Write the seed script**

`backend/scripts/seed.py`:
```python
import asyncio

from sqlalchemy import select

from dots_backend.db import SessionLocal
from dots_backend.models import User

DEMO_NAME = "Chad Mustard"
DEMO_PHONE = "+14155550100"
DEMO_TIMEZONE = "America/Los_Angeles"


async def main() -> None:
    async with SessionLocal() as session:
        existing = await session.execute(select(User).where(User.phone == DEMO_PHONE))
        if existing.scalar_one_or_none() is not None:
            print(f"demo user already seeded ({DEMO_PHONE})")
            return
        user = User(name=DEMO_NAME, phone=DEMO_PHONE, timezone=DEMO_TIMEZONE)
        session.add(user)
        await session.commit()
        await session.refresh(user)
        print(f"seeded demo user id={user.id} phone={user.phone}")


if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 3: Write the fake-caller script**

`backend/scripts/fake_caller.py`:
```python
import asyncio
import sys

import httpx

from dots_backend.config import get_settings

BASE_URL = "http://localhost:8000"


async def main(task_id: str) -> None:
    settings = get_settings()
    headers = {"Authorization": f"Bearer {settings.agent_api_key}"}
    async with httpx.AsyncClient(base_url=BASE_URL, headers=headers) as client:
        await client.post(f"/agent/tasks/{task_id}/events", json={"kind": "CALL_DIALING", "message": "Dialing Luigi's..."})
        await client.post(
            f"/agent/tasks/{task_id}/events",
            json={
                "kind": "TRANSCRIPT",
                "message": "Agent: table for 2 at 6pm?",
                "data": {"speaker": "agent", "text": "Hi, I'd like a table for 2 at 6pm."},
            },
        )
        await client.post(f"/agent/tasks/{task_id}/events", json={"kind": "CALL_ENDED", "message": "Call ended."})
        resp = await client.post(
            f"/agent/tasks/{task_id}/result",
            json={"result": {"outcome": "CONFIRMED", "summary": "Booked a table for 2 at 6pm."}},
        )
        print(resp.status_code, resp.json())


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("usage: python scripts/fake_caller.py <task_id>")
        sys.exit(1)
    asyncio.run(main(sys.argv[1]))
```

- [ ] **Step 4: Write the failing test**

`backend/tests/test_openapi.py`:
```python
from dots_backend.main import app


def test_openapi_has_clean_operation_ids_and_camel_case_schema():
    schema = app.openapi()
    paths = schema["paths"]

    assert paths["/agent/tasks"]["post"]["operationId"] == "create_task"
    assert paths["/agent/tasks/{task_id}"]["get"]["operationId"] == "get_task"

    task_schema = schema["components"]["schemas"]["TaskSchema"]
    assert "userId" in task_schema["properties"]
    assert "createdAt" in task_schema["properties"]
    assert "callbackStatus" in task_schema["properties"]
```

- [ ] **Step 5: Run the test**

Run: `cd backend && uv run pytest tests/test_openapi.py -v`
Expected: PASS. If `operationId` instead comes out as `create_task_agent_tasks_post` or similar, `generate_unique_id_function` isn't wired — double check `_operation_id` is passed to `FastAPI(...)` and that both routers were included before `app.openapi()` is first called (FastAPI caches the schema after the first call in some versions; restart the test process if you regenerate it mid-session).

- [ ] **Step 6: Run the full test suite**

Run: `cd backend && uv run pytest -v`
Expected: all tests across every prior task still PASS.

- [ ] **Step 7: Commit**

```bash
cd backend && git add src/dots_backend/main.py scripts/ tests/test_openapi.py
git commit -m "Wire up FastAPI app with OpenAPI hygiene, add seed and fake-caller scripts"
```

---

## Verification

1. `cd backend && docker compose up -d postgres && uv run alembic upgrade head && uv run python scripts/seed.py`
2. In one terminal: `cd backend && uv run uvicorn dots_backend.main:app --reload`. In another: `cd backend && DISPATCH_MODE=fake uv run python -m dots_backend.worker`.
3. `curl -X POST localhost:8000/agent/tasks -H "Authorization: Bearer dev-agent-key" -H "Idempotency-Key: $(uuidgen)" -H "Content-Type: application/json" -d '{"userId":"<seeded-user-id>","type":"RESERVATION_CALL","title":"Table for 2","payload":{"businessName":"Luigi'"'"'s","phone":"+14155552671","dateTime":"2026-10-01T18:00:00-07:00","partySize":2,"reservationName":"Chad"}}'` should return `201` with a `QUEUED` task. Replaying the same `Idempotency-Key` should return `200` with the same task id.
4. `curl localhost:8000/agent/tasks/<id> -H "Authorization: Bearer dev-agent-key"` should show `RUNNING` (the worker claimed and dispatched it) with `STATUS_CHANGED` events in the timeline.
5. `cd backend && uv run python scripts/fake_caller.py <task_id>` should post `CALL_DIALING`, `TRANSCRIPT`, and `CALL_ENDED` events plus a result; the task becomes `SUCCEEDED`; running it again against the same task id returns `409` from the result endpoint.
6. `cd backend && uv run pytest -v` passes in full against the `dots_test` database.
7. With real LiveKit credentials and `DISPATCH_MODE=livekit`, confirm the dispatch shows up for `dot-caller` (`lk dispatch list task-<id>`) — out of scope to verify in this plan's execution if no LiveKit project is configured; note it as a manual follow-up instead of blocking task completion.
