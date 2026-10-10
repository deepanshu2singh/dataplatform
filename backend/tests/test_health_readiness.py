from __future__ import annotations

import asyncio
import io
import json
import logging

from fastapi.testclient import TestClient

import app.main as main_module
from app.core.health import EXPECTED_ALEMBIC_HEAD, get_readiness_status
from app.core.observability import JSONLogFormatter, REQUEST_ID_HEADER


class _FakeConnection:
    def __init__(
        self,
        *,
        revision: str | None = EXPECTED_ALEMBIC_HEAD,
        ping_error: Exception | None = None,
        migration_error: Exception | None = None,
    ) -> None:
        self.revision = revision
        self.ping_error = ping_error
        self.migration_error = migration_error

    async def execute(self, _statement):
        if self.ping_error is not None:
            raise self.ping_error
        return object()

    async def scalar(self, _statement):
        if self.migration_error is not None:
            raise self.migration_error
        return self.revision


class _FakeConnectContext:
    def __init__(self, connection: _FakeConnection, enter_error: Exception | None = None):
        self.connection = connection
        self.enter_error = enter_error

    async def __aenter__(self):
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
    ) -> None:
        self.connection = _FakeConnection(
            revision=revision,
            ping_error=ping_error,
            migration_error=migration_error,
        )
        self.enter_error = enter_error

    def connect(self):
        return _FakeConnectContext(self.connection, self.enter_error)


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
