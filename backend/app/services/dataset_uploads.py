"""Owner-scoped, transactional completion of browser-direct uploads."""
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
from typing import Callable
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.dataset import Dataset, DatasetType
from app.models.dataset_upload import DatasetUpload
from app.schemas.dataset import DatasetSignedUpload, DatasetUploadPrepare
from app.services.dataset_files import DatasetFileError, dataset_file, python_snapshot_key, run_file_operation
from app.services.python_snapshot import PythonSnapshotTooLarge, prepare_python_snapshot
from app.services.storage import StorageServiceError, get_supabase_storage_service

UPLOAD_LIFETIME = timedelta(hours=2)
EXPIRY_CLEANUP_GRACE = timedelta(minutes=5)


def require_cloud_storage() -> None:
    if settings.STORAGE_BACKEND != "supabase":
        raise HTTPException(409, "Direct cloud uploads are not enabled")


async def prepare_upload(db: AsyncSession, owner_id: int, request: DatasetUploadPrepare) -> DatasetSignedUpload:
    require_cloud_storage()
    if request.file_size > settings.effective_upload_max_bytes:
        raise HTTPException(413, "File exceeds the cloud upload limit")
    filename = Path(request.filename.replace("\\", "/")).name
    if Path(filename).suffix.lower() != ".csv":
        raise HTTPException(400, "CSV files only are supported")
    upload_id = uuid4().hex
    key = f"users/{owner_id}/{upload_id}.csv"
    expires = datetime.now(timezone.utc) + UPLOAD_LIFETIME
    upload = DatasetUpload(
        id=upload_id, owner_id=owner_id, object_key=key,
        bucket=settings.SUPABASE_STORAGE_BUCKET, original_filename=filename,
        name=request.name, description=request.description.strip() or None,
        expected_size=request.file_size, expires_at=expires, status="pending",
    )
    try:
        storage = get_supabase_storage_service()
        signed = await storage.create_signed_upload(key)
        db.add(upload)
        await db.commit()
    except StorageServiceError as exc:
        await db.rollback()
        raise HTTPException(503, "Dataset storage is temporarily unavailable") from exc
    except BaseException:
        await db.rollback()
        raise
    return DatasetSignedUpload(
        upload_id=upload_id, object_key=key, token=signed.token,
        tus_endpoint=signed.tus_endpoint, chunk_size=signed.chunk_size,
        bucket=upload.bucket, expires_at=expires,
    )


async def get_owned_upload(db: AsyncSession, upload_id: str, owner_id: int) -> DatasetUpload:
    result = await db.execute(
        select(DatasetUpload).where(
            DatasetUpload.id == upload_id, DatasetUpload.owner_id == owner_id,
        ).with_for_update(),
    )
    upload = result.scalar_one_or_none()
    if upload is None:
        raise HTTPException(404, "Upload not found")
    if upload.bucket != settings.SUPABASE_STORAGE_BUCKET:
        raise HTTPException(503, "Upload storage bucket is unavailable")
    return upload


async def complete_upload(
    db: AsyncSession, owner_id: int, upload_id: str, infer_schema: Callable,
) -> Dataset:
    require_cloud_storage()
    try:
        upload = await get_owned_upload(db, upload_id, owner_id)
        if upload.status == "completed":
            result = await db.execute(select(Dataset).where(
                Dataset.id == upload.dataset_id, Dataset.owner_id == owner_id,
            ))
            dataset = result.scalar_one_or_none()
            if dataset is None:
                raise HTTPException(410, "The completed dataset has been deleted")
            # Release the intent lock; the completed dataset is already durable.
            await db.commit()
            return dataset
        if upload.status != "pending" or upload.expires_at <= datetime.now(timezone.utc):
            raise HTTPException(410, "This upload has expired or was cancelled")

        config = {
            "storage_backend": "supabase", "object_key": upload.object_key,
            "bucket": upload.bucket, "original_filename": upload.original_filename,
            "file_size": upload.expected_size,
        }
        async with dataset_file(config, owner_id) as path:
            size = path.stat().st_size
            if size != upload.expected_size:
                raise HTTPException(400, "Stored file size does not match the prepared upload")
            try:
                schema = await run_file_operation(infer_schema, path)
                # Large CSV cells must not turn the durable dataset's metadata
                # into an undeliverable API response.
                if len(json.dumps(schema, ensure_ascii=False).encode("utf-8")) > 64 * 1024:
                    schema = {k: v for k, v in schema.items() if k != "sample_data"}
                    schema.update(sample_data=[], sample_row_count=0, sample_truncated=True)
                if len(json.dumps(schema, ensure_ascii=False).encode("utf-8")) > 64 * 1024:
                    raise ValueError("This CSV has too many or excessively long column names")
                content, snapshot = await run_file_operation(
                    prepare_python_snapshot, path, schema.get("row_count"),
                )
            except PythonSnapshotTooLarge:
                # A valid dataset can still be used by SQL when its Python
                # snapshot exceeds the existing browser bridge boundary.
                snapshot = {"too_large": True}
            except ValueError as exc:
                raise HTTPException(400, str(exc)) from exc
            if not snapshot.get("too_large"):
                snapshot["object_key"] = python_snapshot_key(upload.object_key)
                storage = get_supabase_storage_service()
                await storage.upload_bytes(snapshot["object_key"], content, overwrite=True)
            config["python_export"] = snapshot

        dataset = Dataset(
            name=upload.name, description=upload.description, type=DatasetType.FILE,
            config=config, schema_info=schema, owner_id=owner_id,
        )
        db.add(dataset)
        await db.flush()
        upload.dataset_id = dataset.id
        upload.status = "completed"
        await db.commit()
    except DatasetFileError as exc:
        await db.rollback()
        raise HTTPException(exc.status_code, str(exc)) from exc
    except StorageServiceError as exc:
        await db.rollback()
        raise HTTPException(503, "Dataset storage is temporarily unavailable") from exc
    except BaseException:
        # Keep the source and intent retryable if validation/commit fails.
        await db.rollback()
        raise
    await db.refresh(dataset)
    return dataset


async def delete_upload_objects(object_key: str) -> None:
    storage = get_supabase_storage_service()
    await storage.delete_object(object_key)
    await storage.delete_object(python_snapshot_key(object_key))


async def cancel_upload(db: AsyncSession, owner_id: int, upload_id: str) -> None:
    require_cloud_storage()
    try:
        upload = await get_owned_upload(db, upload_id, owner_id)
        if upload.status == "completed":
            raise HTTPException(409, "The upload is already a completed dataset")
        if upload.status in {"cancelled", "expired"}:
            await db.commit()
            return
        await delete_upload_objects(upload.object_key)
        upload.status = "cancelled"
        await db.commit()
    except StorageServiceError as exc:
        await db.rollback()
        raise HTTPException(503, "Dataset storage is temporarily unavailable") from exc
    except BaseException:
        await db.rollback()
        raise


async def cleanup_expired_uploads(db: AsyncSession, *, limit: int = 100) -> int:
    """Call operationally after tokens expire; never remove a live dataset."""
    require_cloud_storage()
    cutoff = datetime.now(timezone.utc) - EXPIRY_CLEANUP_GRACE
    result = await db.execute(select(DatasetUpload).where(
        DatasetUpload.expires_at < cutoff,
        or_(
            DatasetUpload.status.in_(["pending", "cancelled"]),
            and_(DatasetUpload.status == "completed", DatasetUpload.dataset_id.is_(None)),
        ),
    ).order_by(DatasetUpload.expires_at).limit(limit).with_for_update(skip_locked=True))
    count = 0
    try:
        for upload in result.scalars().all():
            if upload.bucket != settings.SUPABASE_STORAGE_BUCKET:
                continue
            await delete_upload_objects(upload.object_key)
            upload.status = "expired"
            count += 1
        await db.commit()
    except BaseException:
        await db.rollback()
        raise
    return count
