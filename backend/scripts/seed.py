import asyncio

from sqlalchemy import select

from dots_backend.db import SessionLocal
from dots_backend.models import User

DEMO_NAME = "Chad Mustard"
DEMO_PHONE = "+14155550100"
DEMO_TIMEZONE = "America/Los_Angeles"


async def main() -> None:
    async with SessionLocal() as session:
        existing = await session.execute(select(User).where(User.phone == DEMO_PHONE))
        if existing.scalar_one_or_none() is not None:
            print(f"demo user already seeded ({DEMO_PHONE})")
            return
        user = User(name=DEMO_NAME, phone=DEMO_PHONE, timezone=DEMO_TIMEZONE)
        session.add(user)
        await session.commit()
        await session.refresh(user)
        print(f"seeded demo user id={user.id} phone={user.phone}")


if __name__ == "__main__":
    asyncio.run(main())
