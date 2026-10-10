import asyncio
import logging
import uuid
from pathlib import Path
from typing import Any, List

import pandas as pd
from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_active_user
from app.core.config import settings
from app.db.session import get_db
from app.db.transactions import commit_with_optimistic_lock
from app.models.dataset import Dataset as DatasetModel
from app.models.dataset import DatasetType
from app.models.user import User as UserModel
from app.schemas.dataset import (
    DatasetPythonExport,
    DatasetRead,
    DatasetUpdate,
)


router = APIRouter()
logger = logging.getLogger(__name__)

CHUNK_SIZE = 1024 * 1024  # 1 MB

# Phase 3A:
# Start with one format and make the complete pipeline reliable.
ALLOWED_EXTENSIONS = {".csv"}

# Browser-Python bridge limits. The complete uploaded dataset remains on the
# backend; only a bounded CSV snapshot is sent to the browser worker.
PYTHON_EXPORT_ROW_LIMIT = 10_000
PYTHON_EXPORT_MAX_BYTES = 10 * 1024 * 1024  # 10 MB


@router.get("", response_model=List[DatasetRead])
async def list_datasets(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    result = await db.execute(
        select(DatasetModel)
        .where(DatasetModel.owner_id == current_user.id)
        .order_by(DatasetModel.created_at.desc())
        .offset(skip)
        .limit(limit)
    )

    return result.scalars().all()


@router.get("/{dataset_id}", response_model=DatasetRead)
async def get_dataset(
    dataset_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    return await _get_owned_dataset(
        db,
        dataset_id,
        current_user.id,
    )


@router.put("/{dataset_id}", response_model=DatasetRead)
async def update_dataset(
    dataset_id: int,
    dataset_in: DatasetUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    dataset = await _get_owned_dataset(
        db,
        dataset_id,
        current_user.id,
    )

    updates = dataset_in.model_dump(exclude_unset=True)

    if "name" in updates:
        updates["name"] = updates["name"].strip()

        if not updates["name"]:
            raise HTTPException(
                status_code=400,
                detail="Dataset name is required",
            )

    if (
        "description" in updates
        and updates["description"] is not None
    ):
        updates["description"] = (
            updates["description"].strip() or None
        )

    for field, value in updates.items():
        setattr(dataset, field, value)

    await commit_with_optimistic_lock(
        db,
        resource_name="Dataset",
    )
    await db.refresh(dataset)

    return dataset


@router.delete(
    "/{dataset_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_dataset(
    dataset_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    dataset = await _get_owned_dataset(
        db,
        dataset_id,
        current_user.id,
    )

    file_path_to_remove: Path | None = None

    if dataset.type == DatasetType.FILE:
        configured_file_path = (
            dataset.config.get("file_path")
            if dataset.config
            else None
        )

        if configured_file_path:
            # Validate the stored path before mutating database state, but do
            # not remove the file until the database delete is committed. If
            # the commit fails, the dataset remains usable instead of pointing
            # at a file that has already been deleted.
            file_path_to_remove = _safe_uploaded_path(configured_file_path)

    await _delete_dataset_record_then_file(
        db,
        dataset,
        file_path_to_remove,
    )


async def _delete_dataset_record_then_file(
    db: AsyncSession,
    dataset: DatasetModel,
    file_path: Path | None,
) -> None:
    """Delete metadata transactionally, then best-effort cleanup the file.

    PostgreSQL and the local filesystem cannot participate in one atomic
    transaction. The database row is therefore committed first: a failed
    database commit never destroys the user's source file. A post-commit file
    cleanup failure can leave an unreferenced file, but it cannot leave a live
    dataset record pointing at missing storage.
    """

    await db.delete(dataset)
    await commit_with_optimistic_lock(
        db,
        resource_name="Dataset",
    )

    if file_path is None:
        return

    try:
        file_path.unlink(missing_ok=True)
    except OSError:
        # The database deletion is already durable. Returning an error here
        # would invite a retry against a record that no longer exists. Keep the
        # API result truthful and leave the orphan for operational cleanup.
        logger.exception(
            "Dataset file cleanup failed after metadata deletion",
            extra={
                "event": "dataset_file_cleanup_failed",
                "resource_type": "dataset",
                "resource_id": getattr(dataset, "id", None),
                "user_id": getattr(dataset, "owner_id", None),
            },
        )


@router.post(
    "/upload",
    response_model=DatasetRead,
    status_code=status.HTTP_201_CREATED,
)
async def upload_file(
    file: UploadFile = File(...),
    name: str = Form(...),
    description: str = Form(""),
    db: AsyncSession = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    clean_name = name.strip()

    if not clean_name:
        raise HTTPException(
            status_code=400,
            detail="Dataset name is required",
        )

    if len(clean_name) > 255:
        raise HTTPException(
            status_code=400,
            detail="Dataset name is too long",
        )

    original_filename = Path(
        file.filename or "upload"
    ).name

    file_ext = Path(
        original_filename
    ).suffix.lower()

    if file_ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail="Phase 3A currently supports CSV files only",
        )

    upload_root = Path(settings.UPLOAD_DIR)

    upload_root.mkdir(
        parents=True,
        exist_ok=True,
    )

    file_path = (
        upload_root
        / f"{uuid.uuid4().hex}{file_ext}"
    )

    size = 0

    try:
        with file_path.open("wb") as destination:
            while True:
                chunk = await file.read(CHUNK_SIZE)

                if not chunk:
                    break

                size += len(chunk)

                if size > settings.MAX_UPLOAD_SIZE:
                    raise HTTPException(
                        status_code=(
                            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE
                        ),
                        detail=(
                            "File exceeds the "
                            f"{settings.MAX_UPLOAD_SIZE // (1024 * 1024)} "
                            "MB upload limit"
                        ),
                    )

                destination.write(chunk)

        if size == 0:
            raise HTTPException(
                status_code=400,
                detail="The uploaded file is empty",
            )

        try:
            schema_info = await asyncio.to_thread(
                infer_csv_schema,
                file_path,
            )
        except ValueError as exc:
            raise HTTPException(
                status_code=400,
                detail=str(exc),
            ) from exc

        dataset = DatasetModel(
            name=clean_name,
            description=description.strip() or None,
            type=DatasetType.FILE,
            config={
                "file_path": str(file_path),
                "original_filename": original_filename,
                "file_size": size,
            },
            schema_info=schema_info,
            owner_id=current_user.id,
        )

        db.add(dataset)

        await db.commit()
        await db.refresh(dataset)

        return dataset

    except Exception:
        await db.rollback()

        file_path.unlink(
            missing_ok=True,
        )

        raise

    finally:
        await file.close()


@router.get("/{dataset_id}/schema")
async def get_dataset_schema(
    dataset_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    dataset = await _get_owned_dataset(
        db,
        dataset_id,
        current_user.id,
    )

    if dataset.type != DatasetType.FILE:
        raise HTTPException(
            status_code=400,
            detail="Only file datasets are supported in V1",
        )

    if dataset.schema_info:
        return dataset.schema_info

    file_path = (
        dataset.config.get("file_path")
        if dataset.config
        else None
    )

    if not file_path:
        raise HTTPException(
            status_code=500,
            detail="Dataset file configuration is missing",
        )

    path = _safe_uploaded_path(file_path)

    if not path.exists():
        raise HTTPException(
            status_code=404,
            detail="Dataset file is missing",
        )

    try:
        return await asyncio.to_thread(
            infer_csv_schema,
            path,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        ) from exc


@router.get(
    "/{dataset_id}/python-export",
    response_model=DatasetPythonExport,
)
async def export_dataset_for_python(
    dataset_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    dataset = await _get_owned_dataset(
        db,
        dataset_id,
        current_user.id,
    )

    if dataset.type != DatasetType.FILE:
        raise HTTPException(
            status_code=400,
            detail="Only file datasets are supported by browser Python in V1",
        )

    file_path = (
        dataset.config.get("file_path")
        if dataset.config
        else None
    )

    if not file_path:
        raise HTTPException(
            status_code=500,
            detail="Dataset file configuration is missing",
        )

    path = _safe_uploaded_path(file_path)

    if not path.exists():
        raise HTTPException(
            status_code=404,
            detail="Dataset file is missing",
        )

    if path.suffix.lower() != ".csv":
        raise HTTPException(
            status_code=400,
            detail="Browser Python currently supports CSV datasets only",
        )

    source_row_count: int | None = None

    if isinstance(dataset.schema_info, dict):
        row_count = dataset.schema_info.get("row_count")

        if isinstance(row_count, int) and row_count >= 0:
            source_row_count = row_count

    try:
        frame = await asyncio.to_thread(
            _read_python_export_frame,
            path,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        ) from exc

    loaded_row_count = min(
        len(frame),
        PYTHON_EXPORT_ROW_LIMIT,
    )
    truncated = len(frame) > PYTHON_EXPORT_ROW_LIMIT

    if truncated:
        frame = frame.iloc[:PYTHON_EXPORT_ROW_LIMIT].copy()

    csv_text = await asyncio.to_thread(
        frame.to_csv,
        None,
        index=False,
    )

    export_size = len(csv_text.encode("utf-8"))

    if export_size > PYTHON_EXPORT_MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=(
                "This dataset snapshot is too large for browser Python. "
                "The V1 bridge is limited to 10 MB after CSV serialization."
            ),
        )

    if (
        source_row_count is not None
        and source_row_count > loaded_row_count
    ):
        truncated = True

    return DatasetPythonExport(
        dataset_id=dataset.id,
        dataset_name=dataset.name,
        csv_text=csv_text,
        source_row_count=source_row_count,
        loaded_row_count=loaded_row_count,
        truncated=truncated,
        row_limit=PYTHON_EXPORT_ROW_LIMIT,
    )


def _read_python_export_frame(
    file_path: Path,
) -> pd.DataFrame:
    try:
        return pd.read_csv(
            file_path,
            nrows=PYTHON_EXPORT_ROW_LIMIT + 1,
        )
    except (
        pd.errors.EmptyDataError,
        pd.errors.ParserError,
        UnicodeDecodeError,
    ) as exc:
        raise ValueError(
            "Could not prepare this CSV for browser Python"
        ) from exc
    except Exception as exc:
        raise ValueError(
            "Could not prepare this CSV for browser Python"
        ) from exc


def infer_csv_schema(
    file_path: Path,
) -> dict[str, Any]:
    try:
        sample = pd.read_csv(
            file_path,
            nrows=100,
        )

    except (
        pd.errors.EmptyDataError,
        pd.errors.ParserError,
        UnicodeDecodeError,
    ) as exc:
        raise ValueError(
            "Could not read this CSV file"
        ) from exc

    except Exception as exc:
        raise ValueError(
            "Could not read this CSV file"
        ) from exc

    if len(sample.columns) == 0:
        raise ValueError(
            "CSV file does not contain any columns"
        )

    row_count = 0

    try:
        for chunk in pd.read_csv(
            file_path,
            chunksize=100_000,
        ):
            row_count += len(chunk)

    except Exception as exc:
        raise ValueError(
            "Could not scan the complete CSV file"
        ) from exc

    first_rows = sample.head(5)

    sample_data = (
        first_rows
        .astype(object)
        .where(
            pd.notna(first_rows),
            None,
        )
        .to_dict(
            orient="records",
        )
    )

    return {
        "columns": [
            {
                "name": str(column),
                "type": str(
                    sample[column].dtype
                ),
            }
            for column in sample.columns
        ],
        "row_count": row_count,
        "sample_row_count": len(sample),
        "sample_data": sample_data,
    }


def _safe_uploaded_path(
    file_path: str,
) -> Path:
    upload_root = Path(
        settings.UPLOAD_DIR
    ).resolve()

    path = Path(
        file_path
    ).resolve()

    if (
        path != upload_root
        and upload_root not in path.parents
    ):
        raise HTTPException(
            status_code=500,
            detail="Unsafe dataset file path",
        )

    return path


async def _get_owned_dataset(
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