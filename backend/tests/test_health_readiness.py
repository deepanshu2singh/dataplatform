from __future__ import annotations

import asyncio
import io
import json
import logging

from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError, ProgrammingError

import app.main as main_module
import app.core.health as health_module
from app.core.health import EXPECTED_ALEMBIC_HEAD, get_readiness_status
from app.core.observability import JSONLogFormatter, REQUEST_ID_HEADER


class _FakeConnection:
    def __init__(
        self,
        *,
        revision: str | None = EXPECTED_ALEMBIC_HEAD,
        ping_error: Exception | None = None,
        migration_error: Exception | None = None,
        migration_delay: float = 0.0,
    ) -> None:
        self.revision = revision
        self.ping_error = ping_error
        self.migration_error = migration_error
        self.migration_delay = migration_delay

    async def execute(self, _statement):
        if self.ping_error is not None:
            raise self.ping_error
        return object()

    async def scalar(self, _statement):
        if self.migration_delay:
            await asyncio.sleep(self.migration_delay)
        if self.migration_error is not None:
            raise self.migration_error
        return self.revision


class _FakeConnectContext:
    def __init__(self, connection: _FakeConnection, enter_error: Exception | None = None, enter_delay: float = 0.0):
        self.connection = connection
        self.enter_error = enter_error
        self.enter_delay = enter_delay

    async def __aenter__(self):
        if self.enter_delay:
            await asyncio.sleep(self.enter_delay)
        if self.enter_error is not None:
            raise self.enter_error
        return self.connection

    async def __aexit__(self, exc_type, exc, tb):
        return False


class _FakeEngine:
    def __init__(
        self,
        *,
        revision: str | None = EXPECTED_ALEMBIC_HEAD,
        enter_error: Exception | None = None,
        ping_error: Exception | None = None,
        migration_error: Exception | None = None,
        enter_delay: float = 0.0,
        migration_delay: float = 0.0,
    ) -> None:
        self.connection = _FakeConnection(
            revision=revision,
            ping_error=ping_error,
            migration_error=migration_error,
            migration_delay=migration_delay,
        )
        self.enter_error = enter_error
        self.enter_delay = enter_delay

    def connect(self):
        return _FakeConnectContext(self.connection, self.enter_error, self.enter_delay)


def _capture_health_logger():
    logger = logging.getLogger("app.health")
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


def _restore_health_logger(logger, handlers, propagate, level) -> None:
    logger.handlers = handlers
    logger.propagate = propagate
    logger.setLevel(level)


def test_liveness_is_lightweight_and_returns_200() -> None:
    client = TestClient(main_module.app)

    response = client.get("/health/live")

    assert response.status_code == 200
    assert response.json() == {"status": "alive"}
    assert REQUEST_ID_HEADER in response.headers


def test_readiness_returns_200_when_database_and_migrations_are_ready(monkeypatch) -> None:
    async def ready_status():
        return True, {"database": "ok", "migrations": "ok"}

    monkeypatch.setattr(main_module, "get_readiness_status", ready_status)
    client = TestClient(main_module.app)

    response = client.get("/health/ready")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ready",
        "checks": {"database": "ok", "migrations": "ok"},
    }
    assert REQUEST_ID_HEADER in response.headers


def test_database_outage_is_not_ready_and_logs_no_infrastructure_secret() -> None:
    secret = "postgresql://dbuser:SUPER_SECRET@private-db.internal:5432/app"
    logger, stream, handlers, propagate, level = _capture_health_logger()

    try:
        ready, checks = asyncio.run(
            get_readiness_status(
                _FakeEngine(enter_error=RuntimeError(secret)),  # type: ignore[arg-type]
            )
        )
    finally:
        _restore_health_logger(logger, handlers, propagate, level)

    assert ready is False
    assert checks == {"database": "unavailable", "migrations": "unknown"}

    output = stream.getvalue()
    assert "SUPER_SECRET" not in output
    assert "private-db.internal" not in output
    entry = json.loads(output.strip())
    assert entry["event"] == "readiness_check_failed"
    assert entry["reason"] == "database_unavailable"


def test_migration_mismatch_is_not_ready_without_exposing_revision() -> None:
    stale_revision = "SENSITIVE_OLD_REVISION"

    ready, checks = asyncio.run(
        get_readiness_status(
            _FakeEngine(revision=stale_revision),  # type: ignore[arg-type]
            expected_head=EXPECTED_ALEMBIC_HEAD,
        )
    )

    assert ready is False
    assert checks == {"database": "ok", "migrations": "out_of_date"}
    assert stale_revision not in json.dumps(checks)
    assert EXPECTED_ALEMBIC_HEAD not in json.dumps(checks)


def test_missing_migration_state_marks_only_migrations_unavailable() -> None:
    ready, checks = asyncio.run(
        get_readiness_status(
            _FakeEngine(
                migration_error=RuntimeError(
                    "alembic_version missing at private-db.internal"
                )
            ),  # type: ignore[arg-type]
        )
    )

    assert ready is False
    assert checks == {"database": "ok", "migrations": "unavailable"}


def test_readiness_failure_is_503_and_correlated_without_internal_details(monkeypatch) -> None:
    async def not_ready_status():
        return False, {"database": "unavailable", "migrations": "unknown"}

    monkeypatch.setattr(main_module, "get_readiness_status", not_ready_status)
    client = TestClient(main_module.app)
    supplied = "phase8d5-ready-failure-001"

    response = client.get(
        "/health/ready",
        headers={REQUEST_ID_HEADER: supplied},
    )

    assert response.status_code == 503
    assert response.headers[REQUEST_ID_HEADER] == supplied
    assert response.json() == {
        "status": "not_ready",
        "checks": {"database": "unavailable", "migrations": "unknown"},
        "request_id": supplied,
    }

    body = response.text.lower()
    assert "postgresql://" not in body
    assert "postgres-test" not in body
    assert "traceback" not in body
    assert "20261006_" not in body


def test_production_accepts_connection_slower_than_previous_two_second_limit(monkeypatch) -> None:
    monkeypatch.setattr(health_module.settings, "ENVIRONMENT", "production")
    assert health_module._readiness_timeout_seconds() == 10.0

    ready, checks = asyncio.run(
        get_readiness_status(_FakeEngine(enter_delay=2.05))  # type: ignore[arg-type]
    )
    assert ready is True
    assert checks == {"database": "ok", "migrations": "ok"}


def test_development_and_test_keep_existing_two_second_budget(monkeypatch) -> None:
    for environment in ("development", "test"):
        monkeypatch.setattr(health_module.settings, "ENVIRONMENT", environment)
        assert health_module._readiness_timeout_seconds() == 2.0


def test_production_timeout_remains_bounded_and_identifiable(monkeypatch) -> None:
    monkeypatch.setattr(health_module.settings, "ENVIRONMENT", "production")
    monkeypatch.setattr(health_module, "_PRODUCTION_READINESS_TIMEOUT_SECONDS", 0.02)
    logger, stream, handlers, propagate, level = _capture_health_logger()
    try:
        ready, checks = asyncio.run(
            get_readiness_status(_FakeEngine(enter_delay=0.1))  # type: ignore[arg-type]
        )
    finally:
        _restore_health_logger(logger, handlers, propagate, level)

    assert ready is False
    assert checks == {"database": "unavailable", "migrations": "unknown"}
    entry = json.loads(stream.getvalue().strip())
    assert "TimeoutError" in entry["exception_types"]
    assert entry["timeout_seconds"] == 0.02
    assert entry["reason"] == "database_unavailable"


def test_revision_timeout_preserves_successful_database_ping(monkeypatch) -> None:
    monkeypatch.setattr(health_module.settings, "ENVIRONMENT", "test")
    monkeypatch.setattr(health_module, "_READINESS_TIMEOUT_SECONDS", 0.02)
    logger, stream, handlers, propagate, level = _capture_health_logger()
    try:
        ready, checks = asyncio.run(
            get_readiness_status(_FakeEngine(migration_delay=0.1))  # type: ignore[arg-type]
        )
    finally:
        _restore_health_logger(logger, handlers, propagate, level)

    assert ready is False
    assert checks == {"database": "ok", "migrations": "unavailable"}
    entry = json.loads(stream.getvalue().strip())
    assert entry["reason"] == "migration_state_unavailable"
    assert "TimeoutError" in entry["exception_types"]


def test_wrapped_authentication_error_logs_driver_type_and_sqlstate_only() -> None:
    class InvalidPasswordError(Exception):
        sqlstate = "28P01"

    wrapped = OperationalError(
        "PRIVATE_SQL_TEXT",
        {"password": "PRIVATE_PARAMETER"},
        InvalidPasswordError("PRIVATE_DRIVER_MESSAGE private-db.internal"),
    )
    logger, stream, handlers, propagate, level = _capture_health_logger()
    try:
        ready, checks = asyncio.run(
            get_readiness_status(_FakeEngine(enter_error=wrapped))  # type: ignore[arg-type]
        )
    finally:
        _restore_health_logger(logger, handlers, propagate, level)

    assert not ready
    assert checks["database"] == "unavailable"
    output = stream.getvalue()
    entry = json.loads(output.strip())
    assert entry["exception_types"] == ["OperationalError", "InvalidPasswordError"]
    assert entry["sqlstate"] == "28P01"
    for private in ("PRIVATE_SQL_TEXT", "PRIVATE_PARAMETER", "PRIVATE_DRIVER_MESSAGE", "private-db.internal"):
        assert private not in output


def test_wrapped_revision_error_logs_safe_driver_diagnostic() -> None:
    class UndefinedTableError(Exception):
        sqlstate = "42P01"

    wrapped = ProgrammingError("PRIVATE_SQL", None, UndefinedTableError("PRIVATE_MESSAGE"))
    logger, stream, handlers, propagate, level = _capture_health_logger()
    try:
        ready, checks = asyncio.run(
            get_readiness_status(_FakeEngine(migration_error=wrapped))  # type: ignore[arg-type]
        )
    finally:
        _restore_health_logger(logger, handlers, propagate, level)

    assert not ready
    assert checks == {"database": "ok", "migrations": "unavailable"}
    output = stream.getvalue()
    entry = json.loads(output.strip())
    assert entry["exception_types"] == ["ProgrammingError", "UndefinedTableError"]
    assert entry["sqlstate"] == "42P01"
    assert "PRIVATE_SQL" not in output
    assert "PRIVATE_MESSAGE" not in output


def test_error_diagnostic_ignores_invalid_codes_and_cycles() -> None:
    error = RuntimeError("DO_NOT_LOG_EXCEPTION_VALUE")
    error.sqlstate = "PRIVATE_CODE_VALUE"  # type: ignore[attr-defined]
    error.orig = error  # type: ignore[attr-defined]
    error.__cause__ = error
    details = health_module._safe_error_details(error, 10.0)
    assert details == {"timeout_seconds": 10.0, "exception_types": ["RuntimeError"]}
