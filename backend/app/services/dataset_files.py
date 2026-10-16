"""Resolve authorized CSVs without granting DuckDB access to a remote URL."""
from __future__ import annotations

import asyncio
import re
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator, Callable, TypeVar

from app.core.config import settings
from app.services.storage import (
    StorageObjectNotFound, StorageObjectTooLarge, StorageServiceError, get_supabase_storage_service,
)

T = TypeVar("T")


class DatasetFileError(ValueError):
    def __init__(self, detail: str, status_code: int = 500) -> None:
        super().__init__(detail)
        self.status_code = status_code


def cloud_object_key(config: dict[str, Any], owner_id: int) -> str:
    key = config.get("object_key")
    if not isinstance(key, str) or not re.fullmatch(
        rf"users/{owner_id}/[0-9a-f]{{32}}\.csv", key,
    ):
        raise DatasetFileError("Dataset storage configuration is invalid")
    if config.get("bucket") != settings.SUPABASE_STORAGE_BUCKET:
        raise DatasetFileError("Dataset storage bucket is unavailable", 503)
    return key


def python_snapshot_key(source_key: str) -> str:
    return source_key[:-4] + ".python.csv"


async def run_file_operation(function: Callable[..., T], *args: Any) -> T:
    """Do not remove a temporary file while a cancelled thread still reads it."""
    task = asyncio.create_task(asyncio.to_thread(function, *args))
    try:
        return await asyncio.shield(task)
    except asyncio.CancelledError:
        while not task.done():
            try:
                await asyncio.shield(task)
            except asyncio.CancelledError:
                continue
            except Exception:
                break
        if task.done() and not task.cancelled():
            task.exception()  # Consume a reader failure; preserve request cancellation.
        raise


@asynccontextmanager
async def dataset_file(config: dict[str, Any], owner_id: int) -> AsyncIterator[Path]:
    backend = config.get("storage_backend", "local")
    if backend == "local":
        value = config.get("file_path")
        if not isinstance(value, str) or not value:
            raise DatasetFileError("Dataset file configuration is missing")
        root = Path(settings.UPLOAD_DIR).resolve()
        path = Path(value).resolve()
        if root not in path.parents or path.suffix.lower() != ".csv":
            raise DatasetFileError("Dataset file path is invalid")
        if not path.is_file():
            raise DatasetFileError("Dataset file is missing", 404)
        yield path
        return

    if backend != "supabase":
        raise DatasetFileError("Dataset storage configuration is invalid")
    key = cloud_object_key(config, owner_id)
    if settings.STORAGE_BACKEND != "supabase":
        raise DatasetFileError("Cloud dataset storage is unavailable", 503)
    try:
        storage = get_supabase_storage_service()
        root = Path(settings.UPLOAD_DIR).resolve()
        root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="dataset-", dir=root) as temporary:
            path = Path(temporary) / "dataset.csv"
            await storage.download_to_path(key, path)
            yield path
    except StorageObjectNotFound as exc:
        raise DatasetFileError("Dataset file is missing from storage", 404) from exc
    except StorageObjectTooLarge as exc:
        raise DatasetFileError("Stored dataset exceeds the cloud upload limit", 413) from exc
    except StorageServiceError as exc:
        raise DatasetFileError("Dataset storage is temporarily unavailable", 503) from exc
    except OSError as exc:
        raise DatasetFileError("Dataset temporary storage is unavailable", 503) from exc
