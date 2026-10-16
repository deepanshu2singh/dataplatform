import io
import json
import logging
import re

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.observability import (
    JSONLogFormatter,
    REQUEST_ID_HEADER,
    RequestLoggingMiddleware,
    get_request_id,
)


def _make_app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(RequestLoggingMiddleware)

    @app.get("/probe")
    async def probe():
        return {"request_id": get_request_id()}

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


def _restore_request_logger(
    logger,
    old_handlers,
    old_propagate,
    old_level,
) -> None:
    logger.handlers = old_handlers
    logger.propagate = old_propagate
    logger.setLevel(old_level)


def test_request_id_is_generated_and_echoed() -> None:
    client = TestClient(_make_app())

    response = client.get("/probe")

    assert response.status_code == 200
    request_id = response.headers[REQUEST_ID_HEADER]

    assert re.fullmatch(r"[0-9a-f]{32}", request_id)
    assert response.json() == {"request_id": request_id}


def test_safe_client_request_id_is_preserved() -> None:
    client = TestClient(_make_app())
    supplied = "proxy-trace_ABC:123.456"

    response = client.get(
        "/probe",
        headers={REQUEST_ID_HEADER: supplied},
    )

    assert response.status_code == 200
    assert response.headers[REQUEST_ID_HEADER] == supplied
    assert response.json() == {"request_id": supplied}


def test_invalid_client_request_id_is_replaced() -> None:
    client = TestClient(_make_app())

    response = client.get(
        "/probe",
        headers={REQUEST_ID_HEADER: "bad id with spaces"},
    )

    replacement = response.headers[REQUEST_ID_HEADER]

    assert response.status_code == 200
    assert replacement != "bad id with spaces"
    assert re.fullmatch(r"[0-9a-f]{32}", replacement)


def test_request_log_is_structured_and_correlated() -> None:
    logger, stream, old_handlers, old_propagate, old_level = (
        _capture_request_logger()
    )

    try:
        client = TestClient(_make_app())
        response = client.get("/probe")
        request_id = response.headers[REQUEST_ID_HEADER]
    finally:
        _restore_request_logger(
            logger,
            old_handlers,
            old_propagate,
            old_level,
        )

    entries = [
        json.loads(line)
        for line in stream.getvalue().splitlines()
        if line.strip()
    ]

    assert len(entries) == 1
    entry = entries[0]

    assert entry["event"] == "http_request_completed"
    assert entry["http_method"] == "GET"
    assert entry["path"] == "/probe"
    assert entry["status_code"] == 200
    assert entry["request_id"] == request_id
    assert isinstance(entry["duration_ms"], (int, float))


def test_request_log_omits_query_headers_cookies_and_body() -> None:
    logger, stream, old_handlers, old_propagate, old_level = (
        _capture_request_logger()
    )

    try:
        client = TestClient(_make_app())
        response = client.get(
            "/probe?token=QUERY_SECRET",
            headers={
                "Authorization": "Bearer AUTH_SECRET",
                "Cookie": "dataplatform_session=COOKIE_SECRET",
                "X-Custom-Secret": "HEADER_SECRET",
            },
        )
        assert response.status_code == 200
    finally:
        _restore_request_logger(
            logger,
            old_handlers,
            old_propagate,
            old_level,
        )

    log_output = stream.getvalue()

    assert "QUERY_SECRET" not in log_output
    assert "AUTH_SECRET" not in log_output
    assert "COOKIE_SECRET" not in log_output
    assert "HEADER_SECRET" not in log_output

    entry = json.loads(log_output.strip())
    assert entry["path"] == "/probe"


def test_readiness_diagnostic_fields_are_bounded_and_validate_their_shape() -> None:
    record = logging.LogRecord("app.health", logging.WARNING, __file__, 1, "Readiness failed", (), None)
    record.exception_types = ["OperationalError", "InvalidPasswordError"]
    record.sqlstate = "28P01"
    record.timeout_seconds = 10.0
    record.database_url = "postgresql://user:PRIVATE_PASSWORD@private.invalid/db"

    rendered = JSONLogFormatter().format(record)
    entry = json.loads(rendered)
    assert entry["exception_types"] == ["OperationalError", "InvalidPasswordError"]
    assert entry["sqlstate"] == "28P01"
    assert entry["timeout_seconds"] == 10.0
    assert "PRIVATE_PASSWORD" not in rendered
    assert "private.invalid" not in rendered

    record.exception_types = [{"secret": "PRIVATE_DICT"}, "PRIVATE TEXT"]
    record.sqlstate = "PRIVATE_CODE"
    record.timeout_seconds = {"secret": "PRIVATE_TIMEOUT"}
    rendered = JSONLogFormatter().format(record)
    entry = json.loads(rendered)
    assert entry["exception_types"] == []
    assert "sqlstate" not in entry
    assert "timeout_seconds" not in entry
    assert "PRIVATE" not in rendered
