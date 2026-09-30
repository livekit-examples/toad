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
