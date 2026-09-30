from fastapi import FastAPI
from fastapi.routing import APIRoute

from dots_backend.api.agent import router as agent_router
from dots_backend.api.ui import router as ui_router


def _operation_id(route: APIRoute) -> str:
    return route.name


app = FastAPI(title="Dots Backend", generate_unique_id_function=_operation_id)
app.include_router(agent_router)
app.include_router(ui_router)
