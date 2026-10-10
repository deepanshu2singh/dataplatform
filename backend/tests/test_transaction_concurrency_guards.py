from __future__ import annotations

import asyncio

import pytest
from fastapi import HTTPException
from sqlalchemy.orm.exc import StaleDataError

import app.db.session as session_module
from app.db.session import get_db
from app.db.transactions import commit_with_optimistic_lock


class FakeCommitSession:
    def __init__(self) -> None:
        self.rollback_calls = 0

    async def commit(self) -> None:
        raise StaleDataError("stale row")

    async def rollback(self) -> None:
        self.rollback_calls += 1


class FakeDependencySession:
    def __init__(self) -> None:
        self.rollback_calls = 0

    async def rollback(self) -> None:
        self.rollback_calls += 1


class FakeSessionContext:
    def __init__(self, session: FakeDependencySession) -> None:
        self.session = session

    async def __aenter__(self) -> FakeDependencySession:
        return self.session

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None


def test_stale_commit_rolls_back_and_becomes_http_409() -> None:
    session = FakeCommitSession()

    with pytest.raises(HTTPException) as caught:
        asyncio.run(
            commit_with_optimistic_lock(
                session,  # type: ignore[arg-type]
                resource_name="Notebook",
            )
        )

    assert caught.value.status_code == 409
    assert "changed or was deleted" in caught.value.detail
    assert session.rollback_calls == 1


def test_request_session_rolls_back_uncaught_exception(monkeypatch) -> None:
    session = FakeDependencySession()

    monkeypatch.setattr(
        session_module,
        "async_session_maker",
        lambda: FakeSessionContext(session),
    )

    async def exercise() -> None:
        dependency = get_db()
        yielded_session = await anext(dependency)
        assert yielded_session is session

        with pytest.raises(RuntimeError, match="route failed"):
            await dependency.athrow(RuntimeError("route failed"))

    asyncio.run(exercise())
    assert session.rollback_calls == 1
