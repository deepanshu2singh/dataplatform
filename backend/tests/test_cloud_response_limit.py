import asyncio
import pytest
from app.core.cloud_response import CloudResponseLimitMiddleware


@pytest.mark.parametrize("enabled,body,status", [(True,b"1234",200),(True,b"12345",413),(False,b"12345",200)])
def test_chunked_response_limit(enabled, body, status):
    sent = []
    async def app(scope, receive, send):
        await send({"type":"http.response.start", "status":200, "headers":[]})
        await send({"type":"http.response.body", "body":body[:2], "more_body":True})
        await send({"type":"http.response.body", "body":body[2:]})
    async def send(message): sent.append(message)
    asyncio.run(CloudResponseLimitMiddleware(app, enabled=enabled, max_bytes=4)({"type":"http"},None,send))
    assert sent[0]["status"] == status
    payload = b"".join(m.get("body",b"") for m in sent)
    assert payload == body if status == 200 else b"too large" in payload


def test_cloud_rejection_keeps_cors_and_request_id():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from fastapi.middleware.cors import CORSMiddleware
    from app.core.observability import RequestLoggingMiddleware
    app = FastAPI()
    @app.get("/large")
    async def large(): return {"data":"x"*100}
    app.add_middleware(CloudResponseLimitMiddleware,enabled=True,max_bytes=20)
    app.add_middleware(RequestLoggingMiddleware)
    app.add_middleware(CORSMiddleware,allow_origins=["https://frontend.example"],allow_credentials=True)
    response = TestClient(app).get("/large",headers={"Origin":"https://frontend.example"})
    assert response.status_code == 413
    assert response.headers["access-control-allow-origin"] == "https://frontend.example"
    assert response.headers["x-request-id"]
