from dots_backend.config import get_settings


def test_settings_loads_required_and_defaults():
    settings = get_settings()
    assert settings.database_url.startswith("postgresql+asyncpg://")
    assert settings.agent_api_key == "test-agent-key"
    assert settings.dispatch_mode == "fake"
    assert settings.caller_agent_name == "dot-caller"
    assert settings.dot_agent_name == "dot"
