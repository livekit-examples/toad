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
