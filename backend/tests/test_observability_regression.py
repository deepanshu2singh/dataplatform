from __future__ import annotations

import io
import json
import logging

from fastapi.testclient import TestClient

import app.main as main_module
from app.core.config import settings
from app.core.observability import (
    GENERIC_SERVER_ERROR_DETAIL,
    JSONLogFormatter,
    REQUEST_ID_HEADER,
)


_EXPLODE_PATH = "/__phase8d7_test__/explode"
_EXPLODE_SECRET = "PHASE8D7_INTERNAL_SECRET"


async def _explode_for_regression() -> None:
    raise RuntimeError(_EXPLODE_SECRET)


# This route exists only in the pytest process. It gives us one controlled
# unexpected failure through the real app.main middleware stack without adding
# a debug/failure endpoint to production source code.
if not any(
    getattr(route, "path", None) == _EXPLODE_PATH
    for route in main_module.app.routes
):
    main_module.app.add_api_route(
        _EXPLODE_PATH,
        _explode_for_regression,
        methods=["GET"],
        include_in_schema=False,
    )


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


def _restore_request_logger(
    logger,
    handlers,
    propagate,
    level,
) -> None:
    logger.handlers = handlers
    logger.propagate = propagate
    logger.setLevel(level)


def test_real_app_success_response_has_correlation_and_cors() -> None:
    client = TestClient(main_module.app)
    request_id = "phase8d7-success-001"

    response = client.get(
        "/health/live",
        headers={
            REQUEST_ID_HEADER: request_id,
            "Origin": settings.FRONTEND_URL,
        },
    )

    assert response.status_code == 200
    assert response.json() == {"status": "alive"}
    assert response.headers[REQUEST_ID_HEADER] == request_id
    assert response.headers["access-control-allow-origin"] == settings.FRONTEND_URL
    assert response.headers["access-control-allow-credentials"] == "true"


def test_real_app_known_404_preserves_safe_error_and_request_id() -> None:
    client = TestClient(main_module.app)
    request_id = "phase8d7-404-001"

    response = client.get(
        "/phase8d7-route-that-does-not-exist",
        headers={
            REQUEST_ID_HEADER: request_id,
            "Origin": settings.FRONTEND_URL,
        },
    )

    assert response.status_code == 404
    assert response.json() == {"detail": "Not Found"}
    assert response.headers[REQUEST_ID_HEADER] == request_id
    assert response.headers["access-control-allow-origin"] == settings.FRONTEND_URL


def test_real_app_unexpected_500_is_safe_correlated_cors_and_redacted() -> None:
    logger, stream, handlers, propagate, level = _capture_request_logger()
    request_id = "phase8d7-500-001"

    try:
        response = TestClient(main_module.app).get(
            _EXPLODE_PATH,
            headers={
                REQUEST_ID_HEADER: request_id,
                "Origin": settings.FRONTEND_URL,
            },
        )
    finally:
        _restore_request_logger(logger, handlers, propagate, level)

    assert response.status_code == 500
    assert response.headers[REQUEST_ID_HEADER] == request_id
    assert response.headers["access-control-allow-origin"] == settings.FRONTEND_URL
    assert response.json() == {
        "detail": GENERIC_SERVER_ERROR_DETAIL,
        "request_id": request_id,
    }
    assert _EXPLODE_SECRET not in response.text

    entries = [
        json.loads(line)
        for line in stream.getvalue().splitlines()
        if line.strip()
    ]
    assert len(entries) == 1
    entry = entries[0]
    assert entry["event"] == "http_request_failed"
    assert entry["request_id"] == request_id
    assert entry["status_code"] == 500
    assert entry["exception_type"] == "RuntimeError"
    assert _EXPLODE_SECRET not in json.dumps(entry)


def test_real_app_readiness_503_is_safe_and_correlated(monkeypatch) -> None:
    async def not_ready_status():
        return False, {"database": "unavailable", "migrations": "unknown"}

    monkeypatch.setattr(main_module, "get_readiness_status", not_ready_status)
    client = TestClient(main_module.app)
    request_id = "phase8d7-ready-503-001"

    response = client.get(
        "/health/ready",
        headers={
            REQUEST_ID_HEADER: request_id,
            "Origin": settings.FRONTEND_URL,
        },
    )

    assert response.status_code == 503
    assert response.headers[REQUEST_ID_HEADER] == request_id
    assert response.headers["access-control-allow-origin"] == settings.FRONTEND_URL
    assert response.json() == {
        "status": "not_ready",
        "checks": {
            "database": "unavailable",
            "migrations": "unknown",
        },
        "request_id": request_id,
    }

    body = response.text.lower()
    assert "postgresql://" not in body
    assert "traceback" not in body
    assert "20261006_" not in body


def test_real_app_csrf_rejection_keeps_request_id_and_rejects_foreign_cors() -> None:
    client = TestClient(main_module.app)
    request_id = "phase8d7-csrf-403-001"

    response = client.post(
        "/api/v1/auth/logout",
        headers={
            REQUEST_ID_HEADER: request_id,
            "Origin": "https://evil.example",
        },
    )

    assert response.status_code == 403
    assert response.json() == {"detail": "Invalid request origin"}
    assert response.headers[REQUEST_ID_HEADER] == request_id
    assert "access-control-allow-origin" not in response.headers
