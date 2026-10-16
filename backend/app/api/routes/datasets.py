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
    DatasetUploadConfig,
    DatasetUploadPrepare,
    DatasetSignedUpload,
)
from app.services.dataset_files import (
    DatasetFileError, cloud_object_key, dataset_file, python_snapshot_key, run_file_operation,
)
from app.services.dataset_uploads import (
    prepare_upload, complete_upload, cancel_upload, delete_upload_objects,
)
from app.services.storage import StorageServiceError, get_supabase_storage_service
from app.services.python_snapshot import PythonSnapshotTooLarge, prepare_python_snapshot


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


@router.get("/upload-config", response_model=DatasetUploadConfig)
async def get_upload_config(current_user: UserModel = Depends(get_current_active_user)):
    return DatasetUploadConfig(
        storage_backend=settings.STORAGE_BACKEND,
        max_upload_bytes=settings.effective_upload_max_bytes,
    )


@router.post("/uploads/prepare", response_model=DatasetSignedUpload, status_code=201)
async def prepare_cloud_upload(
    request: DatasetUploadPrepare,
    db: AsyncSession = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    return await prepare_upload(db, current_user.id, request)


@router.post("/uploads/{upload_id}/complete", response_model=DatasetRead)
async def complete_cloud_upload(
    upload_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    return await complete_upload(db, current_user.id, upload_id, infer_csv_schema)


@router.delete("/uploads/{upload_id}", status_code=204)
async def cancel_cloud_upload(
    upload_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: UserModel = Depends(get_current_active_user),
):
    await cancel_upload(db, current_user.id, upload_id)


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
    cloud_key: str | None = None

    if dataset.type == DatasetType.FILE:
        if (dataset.config or {}).get("storage_backend") == "supabase":
            try:
                cloud_key = cloud_object_key(dataset.config, current_user.id)
            except DatasetFileError as exc:
                raise HTTPException(exc.status_code, str(exc)) from exc
        configured_file_path = (
            dataset.config.get("file_path")
            if dataset.config
            else None
        )

        if configured_file_path and cloud_key is None:
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

    if cloud_key is not None:
        try:
            await delete_upload_objects(cloud_key)
        except StorageServiceError:
            # The metadata commit succeeded. Expiry cleanup can reclaim the
            # completed intent's unreferenced objects without a misleading 500.
            logger.warning(
                "Dataset cloud cleanup failed after metadata deletion",
                extra={"event": "dataset_file_cleanup_failed", "resource_type": "dataset",
                       "resource_id": dataset_id, "user_id": current_user.id},
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
    if settings.STORAGE_BACKEND == "supabase":
        await file.close()
        raise HTTPException(409, "Use the direct cloud upload flow")
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

    try:
        async with dataset_file(dataset.config or {}, current_user.id) as path:
            return await run_file_operation(infer_csv_schema, path)
    except DatasetFileError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc
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

    config = dataset.config or {}
    if config.get("storage_backend") == "supabase":
        try:
            key = cloud_object_key(config, current_user.id)
            snapshot = config.get("python_export")
            if not isinstance(snapshot, dict):
                raise HTTPException(503, "Browser Python snapshot is unavailable")
            if snapshot.get("too_large"):
                raise HTTPException(413, "This dataset snapshot exceeds the 10 MB browser Python limit")
            expected_key = python_snapshot_key(key)
            if snapshot.get("object_key") != expected_key:
                raise HTTPException(500, "Dataset Python snapshot configuration is invalid")
            storage = get_supabase_storage_service()
            url = await storage.create_signed_download(expected_key)
            return DatasetPythonExport(
                dataset_id=dataset.id, dataset_name=dataset.name, download_url=url,
                **{name: value for name, value in snapshot.items() if name != "object_key"},
            )
        except DatasetFileError as exc:
            raise HTTPException(exc.status_code, str(exc)) from exc
        except StorageServiceError as exc:
            raise HTTPException(503, "Dataset storage is temporarily unavailable") from exc

    source_row_count = (dataset.schema_info or {}).get("row_count")
    if not isinstance(source_row_count, int) or source_row_count < 0:
        source_row_count = None
    try:
        async with dataset_file(config, current_user.id) as path:
            content, metadata = await run_file_operation(prepare_python_snapshot, path, source_row_count)
        return DatasetPythonExport(
            dataset_id=dataset.id, dataset_name=dataset.name,
            csv_text=content.decode("utf-8"), **metadata,
        )
    except DatasetFileError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc
    except PythonSnapshotTooLarge as exc:
        raise HTTPException(413, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc



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
