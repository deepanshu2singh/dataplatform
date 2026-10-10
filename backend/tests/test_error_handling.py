import io
import json
import logging

from fastapi import Body, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient

from app.core.csrf import OriginCSRFMiddleware
from app.core.observability import (
    GENERIC_SERVER_ERROR_DETAIL,
    JSONLogFormatter,
    REQUEST_ID_HEADER,
    RequestLoggingMiddleware,
)


def _make_app(*, with_cors: bool = False) -> FastAPI:
    app = FastAPI()

    @app.get("/explode")
    async def explode():
        raise RuntimeError("forced internal failure: INTERNAL_ONLY_MARKER")

    @app.get("/known-error")
    async def known_error():
        raise HTTPException(status_code=409, detail="Known safe conflict")

    @app.post("/validate")
    async def validate_payload(value: int = Body(..., embed=True)):
        return {"value": value}

    # RequestLoggingMiddleware is the application's unexpected-error boundary.
    app.add_middleware(RequestLoggingMiddleware)

    if with_cors:
        # CORS must be outside the error boundary so it can decorate safe 500s.
        app.add_middleware(
            CORSMiddleware,
            allow_origins=["http://localhost:5173"],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
            expose_headers=[REQUEST_ID_HEADER],
        )

    return app


def _capture_request_logger():
    logger = logging.getLogger("app.request")
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(JSONLogFormatter())

    old_handlers = list(logger.handlers)
    old_propagate = logger.propagate
    old_level = logger.level

    logger.handlers = [handler]
    logger.propagate = False
    logger.setLevel(logging.INFO)

    return logger, stream, old_handlers, old_propagate, old_level


def _restore_request_logger(logger, old_handlers, old_propagate, old_level):
    logger.handlers = old_handlers
    logger.propagate = old_propagate
    logger.setLevel(old_level)


def test_unhandled_exception_returns_safe_correlated_json() -> None:
    client = TestClient(_make_app())

    response = client.get("/explode")

    assert response.status_code == 500
    request_id = response.headers[REQUEST_ID_HEADER]
    assert response.json() == {
        "detail": GENERIC_SERVER_ERROR_DETAIL,
        "request_id": request_id,
    }
    body = response.text
    assert "INTERNAL_ONLY_MARKER" not in body
    assert "RuntimeError" not in body
    assert "Traceback" not in body


def test_unhandled_exception_preserves_safe_client_request_id() -> None:
    client = TestClient(_make_app())
    supplied = "frontend-error-boundary-123"

    response = client.get(
        "/explode",
        headers={REQUEST_ID_HEADER: supplied},
    )

    assert response.status_code == 500
    assert response.headers[REQUEST_ID_HEADER] == supplied
    assert response.json()["request_id"] == supplied


def test_unhandled_exception_is_logged_with_same_request_id() -> None:
    logger, stream, old_handlers, old_propagate, old_level = (
        _capture_request_logger()
    )

    try:
        client = TestClient(_make_app())
        response = client.get("/explode")
    finally:
        _restore_request_logger(
            logger,
            old_handlers,
            old_propagate,
            old_level,
        )

    assert response.status_code == 500
    request_id = response.headers[REQUEST_ID_HEADER]
    entries = [
        json.loads(line)
        for line in stream.getvalue().splitlines()
        if line.strip()
    ]

    assert len(entries) == 1
    entry = entries[0]
    assert entry["event"] == "http_request_failed"
    assert entry["status_code"] == 500
    assert entry["request_id"] == request_id
    assert entry["http_method"] == "GET"
    assert entry["path"] == "/explode"
    assert entry["exception_type"] == "RuntimeError"
    assert "RuntimeError" in entry["exception"]
    assert "INTERNAL_ONLY_MARKER" not in entry["exception"]


def test_http_exception_behavior_is_preserved() -> None:
    client = TestClient(_make_app())

    response = client.get("/known-error")

    assert response.status_code == 409
    assert response.json() == {"detail": "Known safe conflict"}
    assert REQUEST_ID_HEADER in response.headers


def test_validation_422_behavior_is_preserved() -> None:
    client = TestClient(_make_app())

    response = client.post("/validate", json={"value": "not-an-int"})

    assert response.status_code == 422
    assert isinstance(response.json().get("detail"), list)
    assert REQUEST_ID_HEADER in response.headers


def test_safe_500_keeps_cors_for_configured_frontend() -> None:
    client = TestClient(_make_app(with_cors=True))

    response = client.get(
        "/explode",
        headers={"Origin": "http://localhost:5173"},
    )

    assert response.status_code == 500
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert response.headers["access-control-allow-credentials"] == "true"
    assert REQUEST_ID_HEADER in response.headers


def test_error_response_does_not_echo_query_or_header_secrets() -> None:
    client = TestClient(_make_app())

    response = client.get(
        "/explode?token=QUERY_SECRET",
        headers={
            "Authorization": "Bearer AUTH_SECRET",
            "Cookie": "dataplatform_session=COOKIE_SECRET",
            "X-Custom-Secret": "HEADER_SECRET",
        },
    )

    assert response.status_code == 500
    body = response.text
    assert "QUERY_SECRET" not in body
    assert "AUTH_SECRET" not in body
    assert "COOKIE_SECRET" not in body
    assert "HEADER_SECRET" not in body


def test_csrf_rejection_remains_correlated_with_final_middleware_order() -> None:
    app = FastAPI()

    @app.post("/api/v1/probe")
    async def probe():
        return {"ok": True}

    # Match app.main ordering: CSRF innermost, request boundary around it,
    # CORS outermost. A rejection should still be correlated.
    app.add_middleware(
        OriginCSRFMiddleware,
        frontend_origin="http://localhost:5173",
        api_prefix="/api/v1",
    )
    app.add_middleware(RequestLoggingMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=[REQUEST_ID_HEADER],
    )

    client = TestClient(app)
    response = client.post("/api/v1/probe")

    assert response.status_code == 403
    assert response.json() == {"detail": "Invalid request origin"}
    assert REQUEST_ID_HEADER in response.headers
