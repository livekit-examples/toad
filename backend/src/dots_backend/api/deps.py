from fastapi import Header, HTTPException, status

from dots_backend.config import get_settings


def require_agent_auth(authorization: str = Header(...)) -> None:
    settings = get_settings()
    if authorization != f"Bearer {settings.agent_api_key}":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid bearer token")


def get_current_user_id(x_user_id: str = Header(...)) -> str:
    return x_user_id
