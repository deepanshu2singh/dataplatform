"""In-process behavior checks. PostgreSQL locking is tested separately."""
import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock
import threading

import pytest
from fastapi import HTTPException
from sqlalchemy.dialects import postgresql

from app.core.config import settings, Settings
from app.services import dataset_files as files, dataset_uploads as uploads
from app.models.dataset import Dataset, DatasetType
from app.models.dataset_upload import DatasetUpload
from app.schemas.dataset import DatasetUploadPrepare
from app.services.dataset_execution import execute_dataset_sql
from app.services.storage import SignedUpload, StorageServiceError, StorageObjectNotFound
from app.services.python_snapshot import prepare_python_snapshot, PythonSnapshotTooLarge
from app.api.routes.datasets import infer_csv_schema

KEY = "users/7/" + "a" * 32 + ".csv"
CSV = b"product,revenue\nLaptop,12\nMonitor,5\n"


class Session:
    def __init__(self, intent=None, dataset=None, commit_error=None):
        self.intent, self.dataset, self.commit_error = intent, dataset, commit_error
        self.added, self.statements, self.commits, self.rollbacks = [], [], 0, 0

    async def execute(self, statement):
        self.statements.append(statement)
        entity = statement.column_descriptions[0]["entity"]
        value = self.intent if entity is DatasetUpload else self.dataset
        return SimpleNamespace(scalar_one_or_none=lambda: value)

    def add(self, row):
        self.added.append(row)
        if isinstance(row, Dataset): self.dataset = row

    async def flush(self):
        self.dataset.id = 55

    async def commit(self):
        self.commits += 1
        if self.commit_error: raise self.commit_error

    async def rollback(self): self.rollbacks += 1
    async def refresh(self, row): pass


@pytest.fixture
def cloud(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "STORAGE_BACKEND", "supabase")
    monkeypatch.setattr(settings, "UPLOAD_DIR", str(tmp_path))
    monkeypatch.setattr(settings, "SUPABASE_STORAGE_BUCKET", "datasets")
    paths = []
    async def download(key, path):
        assert key == KEY
        paths.append(path)
        path.write_bytes(CSV)
        return len(CSV)
    storage = SimpleNamespace(
        download_to_path=AsyncMock(side_effect=download),
        create_signed_upload=AsyncMock(side_effect=lambda key: SignedUpload(key, "test-token", "https://example.storage.supabase.co/storage/v1/upload/resumable/sign")),
        upload_bytes=AsyncMock(), delete_object=AsyncMock(),
    )
    monkeypatch.setattr(files, "get_supabase_storage_service", lambda: storage)
    monkeypatch.setattr(uploads, "get_supabase_storage_service", lambda: storage)
    return storage, paths


def intent(**overrides):
    values = dict(id="a"*32, owner_id=7, object_key=KEY, bucket="datasets",
                  original_filename="sales.csv", name="Sales", description=None,
                  expected_size=len(CSV), status="pending",
                  expires_at=datetime.now(timezone.utc)+timedelta(hours=1))
    return DatasetUpload(**(values | overrides))


def test_cloud_effective_limit_and_https():
    local = Settings(_env_file=None, MAX_UPLOAD_SIZE=100*1024*1024)
    assert local.effective_upload_max_bytes == 100*1024*1024
    configured = dict(_env_file=None, STORAGE_BACKEND="supabase", SUPABASE_SECRET_KEY="test", SUPABASE_URL="https://example.supabase.co")
    assert Settings(**configured).effective_upload_max_bytes == 50*1024*1024
    assert Settings(**configured, MAX_UPLOAD_SIZE=12).effective_upload_max_bytes == 12
    with pytest.raises(ValueError, match="HTTPS"):
        Settings(**(configured | {"SUPABASE_URL": "http://example.supabase.co"}))


def test_prepare_persists_owner_scoped_intent(cloud):
    db = Session()
    result = asyncio.run(uploads.prepare_upload(db, 7, DatasetUploadPrepare(
        name=" Sales ", filename="sales.csv", file_size=len(CSV),
    )))
    assert db.commits == 1
    assert result.tus_endpoint == "https://example.storage.supabase.co/storage/v1/upload/resumable/sign"
    assert result.token == "test-token"
    assert result.object_key == f"users/7/{result.upload_id}.csv"
    assert db.added[0].name == "Sales"
    assert db.added[0].status == "pending"


@pytest.mark.parametrize("filename,size,status", [("bad.txt", 2, 400), ("big.csv", 51*1024*1024, 413)])
def test_prepare_rejects_before_signing(cloud, filename, size, status):
    with pytest.raises(HTTPException) as error:
        asyncio.run(uploads.prepare_upload(Session(), 7, DatasetUploadPrepare(name="test", filename=filename, file_size=size)))
    assert error.value.status_code == status
    cloud[0].create_signed_upload.assert_not_awaited()


def test_complete_replay_query_and_cleanup(cloud):
    storage, paths = cloud
    db = Session(intent())
    first = asyncio.run(uploads.complete_upload(db, 7, db.intent.id, infer_csv_schema))
    second = asyncio.run(uploads.complete_upload(db, 7, db.intent.id, infer_csv_schema))
    assert first is second and first.id == 55
    assert db.intent.status == "completed" and db.intent.dataset_id == 55
    assert len(db.added) == 1
    assert storage.download_to_path.await_count == 1
    storage.upload_bytes.assert_awaited_once()
    assert storage.upload_bytes.call_args.kwargs == {"overwrite": True}
    result = asyncio.run(execute_dataset_sql(first, "SELECT SUM(revenue) AS total FROM dataset", 10))
    assert result["success"] and result["data"] == [{"total": 17.0}]
    assert all(not p.exists() for p in paths)
    assert "FOR UPDATE" in str(db.statements[0].compile(dialect=postgresql.dialect()))
    assert "owner_id" in str(db.statements[0])


@pytest.mark.parametrize("overrides,status", [({"expected_size":1},400), ({"status":"cancelled"},410), ({"expires_at":datetime.now(timezone.utc)-timedelta(minutes=1)},410)])
def test_rejected_completion_keeps_retryable_source(cloud, overrides, status):
    db = Session(intent(**overrides))
    with pytest.raises(HTTPException) as error:
        asyncio.run(uploads.complete_upload(db, 7, db.intent.id, infer_csv_schema))
    assert error.value.status_code == status
    assert db.rollbacks == 1 and not db.added
    cloud[0].delete_object.assert_not_awaited()
    assert all(not p.exists() for p in cloud[1])


def test_missing_foreign_upload_is_404(cloud):
    db = Session()
    with pytest.raises(HTTPException) as error:
        asyncio.run(uploads.complete_upload(db, 8, "a"*32, infer_csv_schema))
    assert error.value.status_code == 404
    assert db.rollbacks == 1
    cloud[0].download_to_path.assert_not_awaited()


def test_commit_failure_keeps_objects(cloud):
    db = Session(intent(), commit_error=RuntimeError("database failed"))
    with pytest.raises(RuntimeError):
        asyncio.run(uploads.complete_upload(db, 7, db.intent.id, infer_csv_schema))
    assert db.rollbacks == 1
    cloud[0].delete_object.assert_not_awaited()
    assert all(not p.exists() for p in cloud[1])


def test_cancel_completed_never_deletes_source(cloud):
    db = Session(intent(status="completed", dataset_id=55))
    with pytest.raises(HTTPException) as error:
        asyncio.run(uploads.cancel_upload(db, 7, db.intent.id))
    assert error.value.status_code == 409
    cloud[0].delete_object.assert_not_awaited()


@pytest.mark.parametrize("key", ["users/8/"+"a"*32+".csv", "users/7/../secret.csv", "https://example.com/file.csv"])
def test_resolver_rejects_wrong_owner_or_path(cloud, key):
    async def run():
        async with files.dataset_file({"storage_backend":"supabase", "bucket":"datasets", "object_key":key}, 7): pass
    with pytest.raises(files.DatasetFileError): asyncio.run(run())
    cloud[0].download_to_path.assert_not_awaited()


@pytest.mark.parametrize("error,status", [(StorageObjectNotFound("secret"),404), (StorageServiceError("secret"),503)])
def test_resolver_masks_storage_errors(cloud, error, status):
    cloud[0].download_to_path.side_effect = error
    async def run():
        async with files.dataset_file({"storage_backend":"supabase", "bucket":"datasets", "object_key":KEY}, 7): pass
    with pytest.raises(files.DatasetFileError) as result: asyncio.run(run())
    assert result.value.status_code == status and "secret" not in str(result.value)


def test_cancel_waits_for_reader_before_temporary_cleanup(cloud):
    entered, release = threading.Event(), threading.Event()
    async def run():
        async def reader():
            async with files.dataset_file({"storage_backend":"supabase", "bucket":"datasets", "object_key":KEY}, 7) as path:
                def blocking():
                    entered.set()
                    assert release.wait(3)
                    assert path.exists()
                    return path.read_bytes()
                await files.run_file_operation(blocking)
        task = asyncio.create_task(reader())
        assert await asyncio.to_thread(entered.wait, 3)
        task.cancel()
        await asyncio.sleep(0)
        assert cloud[1][0].exists() and not task.done()
        release.set()
        with pytest.raises(asyncio.CancelledError): await task
        assert not cloud[1][0].exists()
    try: asyncio.run(run())
    finally: release.set()


def test_python_snapshot_row_limit_hash_and_byte_limit(tmp_path, monkeypatch):
    import hashlib
    import app.services.python_snapshot as snapshots
    path = tmp_path / "many.csv"
    path.write_text("a\n" + "1\n"*10001)
    content, metadata = prepare_python_snapshot(path, 10001)
    assert metadata["loaded_row_count"] == 10000 and metadata["truncated"]
    assert metadata["sha256"] == hashlib.sha256(content).hexdigest()
    assert metadata["csv_size_bytes"] == len(content)
    monkeypatch.setattr(snapshots, "PYTHON_EXPORT_MAX_BYTES", 1)
    with pytest.raises(PythonSnapshotTooLarge): prepare_python_snapshot(path, 10001)


def test_cancel_and_expiry_cleanup_cover_source_and_snapshot(cloud):
    db = Session(intent())
    asyncio.run(uploads.cancel_upload(db,7,db.intent.id))
    assert db.intent.status == "cancelled"
    assert cloud[0].delete_object.await_count == 2
    expired = intent(status="cancelled", expires_at=datetime.now(timezone.utc)-timedelta(hours=1))
    class CleanupSession(Session):
        async def execute(self, statement):
            self.statements.append(statement)
            return SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda:[expired]))
    cleanup = CleanupSession()
    assert asyncio.run(uploads.cleanup_expired_uploads(cleanup)) == 1
    assert expired.status == "expired" and cleanup.commits == 1
    sql = str(cleanup.statements[0].compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds":True}))
    assert "SKIP LOCKED" in sql and "dataset_uploads.dataset_id IS NULL" in sql


def test_invalid_complete_csv_does_not_create_dataset(cloud):
    async def bad_download(key,path): path.write_bytes(b"\xff\xfe\x00")
    cloud[0].download_to_path.side_effect = bad_download
    db = Session(intent(expected_size=3))
    with pytest.raises(HTTPException) as error:
        asyncio.run(uploads.complete_upload(db,7,db.intent.id,infer_csv_schema))
    assert error.value.status_code == 400 and not db.added and db.rollbacks == 1
    cloud[0].delete_object.assert_not_awaited()
