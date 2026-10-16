from __future__ import annotations

import asyncio
import logging
import re
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from app.core.observability import get_request_id
from app.core.config import settings
from app.db.session import engine


_READINESS_LOGGER = logging.getLogger("app.health")
_READINESS_TIMEOUT_SECONDS = 2.0
_PRODUCTION_READINESS_TIMEOUT_SECONDS = 10.0
_PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _readiness_timeout_seconds() -> float:
    # Production may make a fresh TLS/pooler connection on each cold invocation.
    # Development/test probes retain their existing two-second budget.
    if settings.ENVIRONMENT == "production":
        return _PRODUCTION_READINESS_TIMEOUT_SECONDS
    return _READINESS_TIMEOUT_SECONDS


def _safe_error_details(exc: BaseException, timeout_seconds: float) -> dict[str, object]:
    """Describe wrapped driver failures without serializing exception values."""

    details: dict[str, object] = {"timeout_seconds": timeout_seconds}
    exception_types: list[str] = []
    pending = [exc]
    seen: set[int] = set()

    while pending and len(seen) < 8:
        current = pending.pop(0)
        if not isinstance(current, BaseException) or id(current) in seen:
            continue
        seen.add(id(current))

        name = type(current).__name__
        if len(name) <= 80 and name.isidentifier() and name not in exception_types:
            exception_types.append(name)

        for attribute in ("sqlstate", "pgcode"):
            code = getattr(current, attribute, None)
            if isinstance(code, str) and re.fullmatch(r"[0-9A-Z]{5}", code):
                details["sqlstate"] = code

        for attribute in ("orig", "__cause__", "__context__"):
            wrapped = getattr(current, attribute, None)
            if isinstance(wrapped, BaseException):
                pending.append(wrapped)

    details["exception_types"] = exception_types
    return details


def _expected_alembic_head() -> str:
    """Resolve the migration head from the migration scripts shipped with the app."""

    config = Config(str(_PROJECT_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(_PROJECT_ROOT / "alembic"))
    script = ScriptDirectory.from_config(config)
    head = script.get_current_head()

    if not head:
        raise RuntimeError("Application migration head could not be determined")

    return head


EXPECTED_ALEMBIC_HEAD = _expected_alembic_head()


async def get_readiness_status(
    db_engine: AsyncEngine = engine,
    *,
    expected_head: str = EXPECTED_ALEMBIC_HEAD,
) -> tuple[bool, dict[str, str]]:
    """Check required serving dependencies without exposing infrastructure details.

    Liveness is deliberately separate from this function. Readiness requires both
    a working database connection and the database's Alembic revision to match
    the migration head shipped with this application build.
    """

    checks = {
        "database": "unavailable",
        "migrations": "unknown",
    }

    timeout_seconds = _readiness_timeout_seconds()

    try:
        async with asyncio.timeout(timeout_seconds):
            async with db_engine.connect() as connection:
                await connection.execute(text("SELECT 1"))
                checks["database"] = "ok"

                try:
                    current_revision = await connection.scalar(
                        text("SELECT version_num FROM alembic_version LIMIT 1")
                    )
                except Exception as exc:
                    _READINESS_LOGGER.warning(
                        "Readiness migration check unavailable",
                        extra={
                            "event": "readiness_check_failed",
                            "reason": "migration_state_unavailable",
                            "operation": "readiness",
                            "request_id": get_request_id(),
                            **_safe_error_details(exc, timeout_seconds),
                        },
                    )
                    checks["migrations"] = "unavailable"
                    return False, checks
    except Exception as exc:
        # A timeout during the revision read must not misreport a successful
        # database ping as a database outage.
        reason = "database_unavailable"
        if checks["database"] == "ok":
            checks["migrations"] = "unavailable"
            reason = "migration_state_unavailable"
        _READINESS_LOGGER.warning(
            "Readiness dependency check failed",
            extra={
                "event": "readiness_check_failed",
                "reason": reason,
                "operation": "readiness",
                "request_id": get_request_id(),
                **_safe_error_details(exc, timeout_seconds),
            },
        )
        return False, checks

    if current_revision != expected_head:
        checks["migrations"] = "out_of_date"
        _READINESS_LOGGER.warning(
            "Readiness migration revision mismatch",
            extra={
                "event": "readiness_check_failed",
                "reason": "migration_mismatch",
                "operation": "readiness",
                "request_id": get_request_id(),
            },
        )
        return False, checks

    checks["migrations"] = "ok"
    return True, checks
