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
