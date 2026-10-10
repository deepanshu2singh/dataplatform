from __future__ import annotations

import io
import json
import logging

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.observability import JSONLogFormatter, RequestLoggingMiddleware


def _render_record(record: logging.LogRecord) -> dict:
    return json.loads(JSONLogFormatter().format(record))


def test_formatter_redacts_credentials_in_message() -> None:
    logger = logging.getLogger("app.redaction-test")
    record = logger.makeRecord(
        logger.name,
        logging.ERROR,
        __file__,
        1,
        (
            "Authorization: Bearer bearer-secret Cookie: session=COOKIE_SECRET "
            "dataplatform_session=SESSION_SECRET SECRET_KEY=SUPER_SECRET "
            "password=PASSWORD_SECRET token=TOKEN_SECRET"
        ),
        (),
        None,
    )

    entry = _render_record(record)
    output = json.dumps(entry)

    for secret in (
        "bearer-secret",
        "COOKIE_SECRET",
        "SESSION_SECRET",
        "SUPER_SECRET",
        "PASSWORD_SECRET",
        "TOKEN_SECRET",
    ):
        assert secret not in output

    assert "[REDACTED]" in output or "[REDACTED_SECRET]" in output


def test_formatter_redacts_database_credentials_and_upload_paths() -> None:
    logger = logging.getLogger("app.redaction-test")
    record = logger.makeRecord(
        logger.name,
        logging.ERROR,
        __file__,
        1,
        (
            "database postgresql+asyncpg://dbuser:db-password@postgres:5432/app "
            "file=/srv/app/uploads/private/customer.csv"
        ),
        (),
        None,
    )

    output = json.dumps(_render_record(record))

    assert "db-password" not in output
    assert "customer.csv" not in output
    assert "[REDACTED]" in output
    assert "[REDACTED_UPLOAD_PATH]" in output


def test_exception_log_keeps_type_and_stack_but_omits_exception_value() -> None:
    logger = logging.getLogger("app.redaction-test")

    try:
        raise RuntimeError(
            "TOP_SECRET postgresql://user:password@host/db "
            "/srv/app/uploads/private.csv"
        )
    except RuntimeError:
        record = logger.makeRecord(
            logger.name,
            logging.ERROR,
            __file__,
            1,
            "Operation failed",
            (),
            exc_info=__import__("sys").exc_info(),
        )

    entry = _render_record(record)
    output = json.dumps(entry)

    assert entry["exception_type"] == "RuntimeError"
    assert "RuntimeError" in entry["exception"]
    assert "test_exception_log_keeps_type" in entry["exception"]
    assert "TOP_SECRET" not in output
    assert "password" not in output
    assert "private.csv" not in output


def test_structured_string_fields_are_redacted() -> None:
    logger = logging.getLogger("app.redaction-test")
    record = logger.makeRecord(
        logger.name,
        logging.WARNING,
        __file__,
        1,
        "Safe message",
        (),
        None,
        extra={
            "event": "example_event",
            "reason": "token=STRUCTURED_SECRET",
            "resource_type": "dataset",
            "resource_id": 42,
            "user_id": 7,
        },
    )

    entry = _render_record(record)
    output = json.dumps(entry)

    assert "STRUCTURED_SECRET" not in output
    assert entry["resource_id"] == 42
    assert entry["user_id"] == 7


def test_request_failure_log_does_not_contain_exception_secret() -> None:
    app = FastAPI()

    @app.get("/explode")
    async def explode():
        raise RuntimeError("REQUEST_EXCEPTION_SECRET")

    app.add_middleware(RequestLoggingMiddleware)

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

    try:
        response = TestClient(app).get("/explode")
    finally:
        logger.handlers = old_handlers
        logger.propagate = old_propagate
        logger.setLevel(old_level)

    assert response.status_code == 500
    log_output = stream.getvalue()
    assert "REQUEST_EXCEPTION_SECRET" not in log_output
    assert "RuntimeError" in log_output
