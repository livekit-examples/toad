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
