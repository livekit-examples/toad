import asyncio
import sys

import httpx

from dots_backend.config import get_settings

BASE_URL = "http://localhost:8000"


async def main(task_id: str) -> None:
    settings = get_settings()
    headers = {"Authorization": f"Bearer {settings.agent_api_key}"}
    async with httpx.AsyncClient(base_url=BASE_URL, headers=headers) as client:
        await client.post(f"/agent/tasks/{task_id}/events", json={"kind": "CALL_DIALING", "message": "Dialing Luigi's..."})
        await client.post(
            f"/agent/tasks/{task_id}/events",
            json={
                "kind": "TRANSCRIPT",
                "message": "Agent: table for 2 at 6pm?",
                "data": {"speaker": "agent", "text": "Hi, I'd like a table for 2 at 6pm."},
            },
        )
        await client.post(f"/agent/tasks/{task_id}/events", json={"kind": "CALL_ENDED", "message": "Call ended."})
        resp = await client.post(
            f"/agent/tasks/{task_id}/result",
            json={"result": {"outcome": "CONFIRMED", "summary": "Booked a table for 2 at 6pm."}},
        )
        print(resp.status_code, resp.json())


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("usage: python scripts/fake_caller.py <task_id>")
        sys.exit(1)
    asyncio.run(main(sys.argv[1]))
