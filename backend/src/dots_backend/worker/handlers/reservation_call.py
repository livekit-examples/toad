from dots_backend.models import Task
from dots_backend.services import tasks as task_service
from dots_backend.worker.registry import Delegated, HandlerContext, register


async def handle(task: Task, ctx: HandlerContext) -> Delegated:
    room_name = f"task-{task.id}"
    metadata = {
        "taskId": str(task.id),
        "type": task.type,
        "payload": task.payload,
        "to": task.payload["phone"],
        "maxDurationSec": 180,
    }
    dispatch_id = await ctx.dispatcher.dispatch(
        agent_name=ctx.settings.caller_agent_name,
        room_name=room_name,
        metadata=metadata,
    )
    await task_service.set_dispatch_info(ctx.session, task.id, room_name=room_name, dispatch_id=dispatch_id)
    return Delegated()


register("RESERVATION_CALL", handle)
