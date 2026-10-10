from __future__ import annotations

import asyncio
import io
import json
import logging
from pathlib import Path

import pytest
from fastapi import HTTPException
from sqlalchemy.orm.exc import StaleDataError

from app.api.routes.datasets import _delete_dataset_record_then_file
from app.core.observability import JSONLogFormatter
from app.db.transactions import commit_with_optimistic_lock


class FakeSession:
    def __init__(self, *, commit_error: Exception | None = None) -> None:
        self.commit_error = commit_error
        self.deleted = []
        self.rollback_calls = 0

    async def delete(self, value) -> None:
        self.deleted.append(value)

    async def commit(self) -> None:
        if self.commit_error is not None:
            raise self.commit_error

    async def rollback(self) -> None:
        self.rollback_calls += 1


def _capture_logger(name: str):
    logger = logging.getLogger(name)
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


def _restore_logger(logger, handlers, propagate, level) -> None:
    logger.handlers = handlers
    logger.propagate = propagate
    logger.setLevel(level)


def test_dataset_cleanup_failure_logs_safe_metadata_without_file_path(
    tmp_path,
    monkeypatch,
) -> None:
    file_path = tmp_path / "SENSITIVE_FILE_NAME.csv"
    file_path.write_text("a\n1\n", encoding="utf-8")

    class Dataset:
        id = 123
        owner_id = 456

    def fail_unlink(self, missing_ok=False):
        raise OSError(f"cannot delete {self}")

    monkeypatch.setattr(Path, "unlink", fail_unlink)

    logger, stream, handlers, propagate, level = _capture_logger(
        "app.api.routes.datasets"
    )

    try:
        asyncio.run(
            _delete_dataset_record_then_file(
                FakeSession(),  # type: ignore[arg-type]
                Dataset(),  # type: ignore[arg-type]
                file_path,
            )
        )
    finally:
        _restore_logger(logger, handlers, propagate, level)

    entry = json.loads(stream.getvalue().strip())
    output = json.dumps(entry)

    assert entry["event"] == "dataset_file_cleanup_failed"
    assert entry["resource_type"] == "dataset"
    assert entry["resource_id"] == 123
    assert entry["user_id"] == 456
    assert "SENSITIVE_FILE_NAME.csv" not in output
    assert str(tmp_path) not in output


def test_optimistic_conflict_emits_safe_domain_event() -> None:
    logger, stream, handlers, propagate, level = _capture_logger(
        "app.db.transactions"
    )
    session = FakeSession(commit_error=StaleDataError("SENSITIVE_ROW_STATE"))

    try:
        with pytest.raises(HTTPException) as exc_info:
            asyncio.run(
                commit_with_optimistic_lock(
                    session,  # type: ignore[arg-type]
                    resource_name="Notebook",
                )
            )
    finally:
        _restore_logger(logger, handlers, propagate, level)

    assert exc_info.value.status_code == 409
    assert session.rollback_calls == 1

    entry = json.loads(stream.getvalue().strip())
    output = json.dumps(entry)

    assert entry["event"] == "optimistic_concurrency_conflict"
    assert entry["resource_type"] == "notebook"
    assert "SENSITIVE_ROW_STATE" not in output
