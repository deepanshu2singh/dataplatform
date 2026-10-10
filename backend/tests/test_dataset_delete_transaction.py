from __future__ import annotations

import asyncio

import pytest

from app.api.routes.datasets import _delete_dataset_record_then_file


class FakeSession:
    def __init__(self, *, commit_error: Exception | None = None) -> None:
        self.commit_error = commit_error
        self.deleted = []
        self.commit_calls = 0
        self.rollback_calls = 0

    async def delete(self, value) -> None:
        self.deleted.append(value)

    async def commit(self) -> None:
        self.commit_calls += 1
        if self.commit_error is not None:
            raise self.commit_error

    async def rollback(self) -> None:
        self.rollback_calls += 1


def test_dataset_file_is_removed_only_after_database_commit(tmp_path) -> None:
    file_path = tmp_path / "dataset.csv"
    file_path.write_text("a,b\n1,2\n", encoding="utf-8")
    session = FakeSession()
    dataset = object()

    asyncio.run(
        _delete_dataset_record_then_file(
            session,  # type: ignore[arg-type]
            dataset,  # type: ignore[arg-type]
            file_path,
        )
    )

    assert session.deleted == [dataset]
    assert session.commit_calls == 1
    assert session.rollback_calls == 0
    assert not file_path.exists()


def test_failed_database_commit_keeps_dataset_file_and_rolls_back(tmp_path) -> None:
    file_path = tmp_path / "dataset.csv"
    file_path.write_text("a,b\n1,2\n", encoding="utf-8")
    session = FakeSession(commit_error=RuntimeError("commit failed"))
    dataset = object()

    with pytest.raises(RuntimeError, match="commit failed"):
        asyncio.run(
            _delete_dataset_record_then_file(
                session,  # type: ignore[arg-type]
                dataset,  # type: ignore[arg-type]
                file_path,
            )
        )

    assert session.deleted == [dataset]
    assert session.commit_calls == 1
    assert session.rollback_calls == 1
    assert file_path.exists()
