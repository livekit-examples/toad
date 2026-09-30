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
    TaskEventSchema,
    TaskListResponse,
    TaskResponse,
    TaskSchema,
    TaskWithEventsResponse,
    UpdateMeRequest,
    UserSchema,
)
from dots_backend.services import tasks as task_service
from dots_backend.services.tasks import TaskAlreadyFinal

router = APIRouter(prefix="/api")


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
