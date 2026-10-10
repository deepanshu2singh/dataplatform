import logging

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.exc import StaleDataError


logger = logging.getLogger(__name__)


async def commit_with_optimistic_lock(
    db: AsyncSession,
    *,
    resource_name: str,
) -> None:
    """Commit one mutation and turn stale-row races into a controlled 409.

    SQLAlchemy's version_id_col adds the loaded version to UPDATE/DELETE
    predicates. If another request commits first, the second mutation matches
    zero rows and raises StaleDataError instead of silently overwriting data.
    """

    try:
        await db.commit()
    except StaleDataError as exc:
        await db.rollback()
        logger.warning(
            "Optimistic concurrency conflict",
            extra={
                "event": "optimistic_concurrency_conflict",
                "resource_type": resource_name.lower(),
            },
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"{resource_name} changed or was deleted by another request. "
                "Refresh and try again."
            ),
        ) from exc
    except Exception:
        await db.rollback()
        raise
