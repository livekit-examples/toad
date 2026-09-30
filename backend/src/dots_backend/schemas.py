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
