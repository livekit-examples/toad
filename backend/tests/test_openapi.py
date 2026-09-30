from dots_backend.main import app


def test_openapi_has_clean_operation_ids_and_camel_case_schema():
    schema = app.openapi()
    paths = schema["paths"]

    assert paths["/agent/tasks"]["post"]["operationId"] == "create_task"
    assert paths["/agent/tasks/{task_id}"]["get"]["operationId"] == "get_task"

    task_schema = schema["components"]["schemas"]["TaskSchema"]
    assert "userId" in task_schema["properties"]
    assert "createdAt" in task_schema["properties"]
    assert "callbackStatus" in task_schema["properties"]
