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
