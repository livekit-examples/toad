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
