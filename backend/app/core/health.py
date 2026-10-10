from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from app.core.observability import get_request_id
from app.db.session import engine


_READINESS_LOGGER = logging.getLogger("app.health")
_READINESS_TIMEOUT_SECONDS = 2.0
_PROJECT_ROOT = Path(__file__).resolve().parents[2]


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

    try:
        async with asyncio.timeout(_READINESS_TIMEOUT_SECONDS):
            async with db_engine.connect() as connection:
                await connection.execute(text("SELECT 1"))
                checks["database"] = "ok"

                try:
                    current_revision = await connection.scalar(
                        text("SELECT version_num FROM alembic_version LIMIT 1")
                    )
                except Exception:
                    _READINESS_LOGGER.warning(
                        "Readiness migration check unavailable",
                        extra={
                            "event": "readiness_check_failed",
                            "reason": "migration_state_unavailable",
                            "operation": "readiness",
                            "request_id": get_request_id(),
                        },
                    )
                    checks["migrations"] = "unavailable"
                    return False, checks
    except Exception:
        _READINESS_LOGGER.warning(
            "Readiness database check failed",
            extra={
                "event": "readiness_check_failed",
                "reason": "database_unavailable",
                "operation": "readiness",
                "request_id": get_request_id(),
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
