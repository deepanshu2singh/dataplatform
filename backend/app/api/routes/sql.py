import logging
from typing import Any

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    status,
)
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    get_current_active_user,
)
from app.db.session import get_db
from app.models.dataset import (
    Dataset as DatasetModel,
    DatasetType,
)
from app.models.user import (
    User as UserModel,
)
from app.services.sql_executor import (
    SQLValidationError,
    sql_executor,
)
from app.services.dataset_execution import execute_dataset_sql
from app.services.dataset_files import DatasetFileError


router = APIRouter()
logger = logging.getLogger(__name__)


class SQLQueryRequest(BaseModel):
    query: str = Field(
        min_length=1,
        max_length=50_000,
    )

    dataset_id: int = Field(
        gt=0,
    )

    limit: int = Field(
        default=1000,
        ge=1,
        le=1000,
    )


class SQLQueryResponse(BaseModel):
    success: bool

    columns: list[str] = Field(
        default_factory=list,
    )

    data: list[dict[str, Any]] = Field(
        default_factory=list,
    )

    row_count: int = 0

    dtypes: dict[str, str] = Field(
        default_factory=dict,
    )

    truncated: bool = False

    limit: int = 1000

    execution_ms: float = 0

    error: str | None = None


def _log_sql_failure(
    *,
    dataset_id: int,
    user_id: int,
    reason: str,
    execution_ms: float | None = None,
) -> None:
    extra: dict[str, object] = {
        "event": "sql_execution_failed",
        "resource_type": "dataset",
        "resource_id": dataset_id,
        "user_id": user_id,
        "reason": reason,
    }

    if execution_ms is not None:
        extra["duration_ms"] = execution_ms

    logger.warning(
        "SQL execution failed",
        extra=extra,
    )


@router.post(
    "/query",
    response_model=SQLQueryResponse,
)
async def execute_sql(
    request: SQLQueryRequest,
    db: AsyncSession = Depends(get_db),
    current_user: UserModel = Depends(
        get_current_active_user
    ),
):
    dataset = await get_owned_dataset(
        db,
        request.dataset_id,
        current_user.id,
    )

    ensure_file_dataset(
        dataset,
    )

    try:
        result = await execute_dataset_sql(
            dataset,
            request.query,
            request.limit,
        )

        if not result.get("success"):
            error = str(result.get("error") or "")
            _log_sql_failure(
                dataset_id=request.dataset_id,
                user_id=current_user.id,
                reason=(
                    "timeout"
                    if "execution limit" in error.lower()
                    else "execution"
                ),
                execution_ms=float(result.get("execution_ms") or 0),
            )

        raise_for_failed_execution(
            result
        )

    except DatasetFileError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc
    except SQLValidationError as exc:
        _log_sql_failure(
            dataset_id=request.dataset_id,
            user_id=current_user.id,
            reason="validation",
        )
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        ) from exc

    return SQLQueryResponse(
        **result,
    )


@router.post(
    "/preview/{dataset_id}",
    response_model=SQLQueryResponse,
)
async def preview_dataset(
    dataset_id: int,
    limit: int = Query(
        default=100,
        ge=1,
        le=1000,
    ),
    db: AsyncSession = Depends(get_db),
    current_user: UserModel = Depends(
        get_current_active_user
    ),
):
    dataset = await get_owned_dataset(
        db,
        dataset_id,
        current_user.id,
    )

    ensure_file_dataset(
        dataset,
    )

    try:
        result = await execute_dataset_sql(
            dataset,
            "SELECT * FROM dataset",
            limit,
        )

        if not result.get("success"):
            error = str(result.get("error") or "")
            _log_sql_failure(
                dataset_id=dataset_id,
                user_id=current_user.id,
                reason=(
                    "timeout"
                    if "execution limit" in error.lower()
                    else "execution"
                ),
                execution_ms=float(result.get("execution_ms") or 0),
            )

        raise_for_failed_execution(
            result
        )

    except DatasetFileError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc
    except SQLValidationError as exc:
        _log_sql_failure(
            dataset_id=dataset_id,
            user_id=current_user.id,
            reason="validation",
        )
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        ) from exc

    return SQLQueryResponse(
        **result,
    )


async def get_owned_dataset(
    db: AsyncSession,
    dataset_id: int,
    owner_id: int,
) -> DatasetModel:
    result = await db.execute(
        select(DatasetModel).where(
            DatasetModel.id == dataset_id,
            DatasetModel.owner_id == owner_id,
        )
    )

    dataset = result.scalar_one_or_none()

    if not dataset:
        raise HTTPException(
            status_code=404,
            detail="Dataset not found",
        )

    return dataset


def ensure_file_dataset(
    dataset: DatasetModel,
) -> None:
    if dataset.type != DatasetType.FILE:
        raise HTTPException(
            status_code=400,
            detail=(
                "Phase 4 currently supports "
                "file datasets only."
            ),
        )


def raise_for_failed_execution(
    result: dict[str, Any],
) -> None:
    if result.get("success"):
        return

    error = (
        result.get("error")
        or "SQL execution failed."
    )

    if "execution limit" in error.lower():
        status_code = (
            status.HTTP_408_REQUEST_TIMEOUT
        )
    else:
        status_code = (
            status.HTTP_400_BAD_REQUEST
        )

    raise HTTPException(
        status_code=status_code,
        detail=error,
    )
