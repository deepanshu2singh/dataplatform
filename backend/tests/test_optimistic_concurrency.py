from __future__ import annotations

import asyncio
import os
from pathlib import Path
import subprocess
from urllib.parse import urlsplit, urlunsplit
from uuid import uuid4

import asyncpg
import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm.exc import StaleDataError

from app.models.dashboard import Dashboard
from app.models.dataset import Dataset
from app.models.notebook import Notebook


BACKEND_ROOT = Path(__file__).resolve().parents[1]


def _test_database_parts() -> tuple[str, str, str]:
    base_url = os.environ["TEST_DATABASE_URL"]
    parsed = urlsplit(base_url)
    admin_url = urlunsplit((parsed.scheme, parsed.netloc, "/postgres", "", ""))
    database_name = f"optimistic_{uuid4().hex[:16]}"
    async_database_url = urlunsplit(
        ("postgresql+asyncpg", parsed.netloc, f"/{database_name}", "", "")
    )
    direct_database_url = urlunsplit(
        (parsed.scheme, parsed.netloc, f"/{database_name}", "", "")
    )
    return admin_url, direct_database_url, async_database_url


async def _create_database(admin_url: str, database_name: str) -> None:
    connection = await asyncpg.connect(admin_url)
    try:
        await connection.execute(f'CREATE DATABASE "{database_name}"')
    finally:
        await connection.close()


async def _drop_database(admin_url: str, database_name: str) -> None:
    connection = await asyncpg.connect(admin_url)
    try:
        await connection.execute(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
            "WHERE datname = $1 AND pid <> pg_backend_pid()",
            database_name,
        )
        await connection.execute(f'DROP DATABASE IF EXISTS "{database_name}"')
    finally:
        await connection.close()


def _run_alembic(
    async_database_url: str,
    *args: str,
) -> subprocess.CompletedProcess[str]:
    environment = os.environ.copy()
    environment["DATABASE_URL"] = async_database_url
    return subprocess.run(
        ["alembic", *args],
        cwd=BACKEND_ROOT,
        env=environment,
        text=True,
        capture_output=True,
        check=False,
    )


def _with_database(test_body) -> None:
    admin_url, direct_url, async_url = _test_database_parts()
    database_name = urlsplit(direct_url).path.lstrip("/")
    asyncio.run(_create_database(admin_url, database_name))
    try:
        upgrade = _run_alembic(async_url, "upgrade", "head")
        assert upgrade.returncode == 0, upgrade.stderr
        test_body(direct_url, async_url)
    finally:
        asyncio.run(_drop_database(admin_url, database_name))


async def _seed_records(database_url: str) -> tuple[int, int, int]:
    connection = await asyncpg.connect(database_url)
    try:
        owner_id = await connection.fetchval(
            """
            INSERT INTO users (email, hashed_password)
            VALUES ($1, 'hash')
            RETURNING id
            """,
            f"optimistic-{uuid4().hex}@example.com",
        )
        dataset_id = await connection.fetchval(
            """
            INSERT INTO datasets (name, type, config, owner_id)
            VALUES ('Dataset', 'FILE', '{}'::json, $1)
            RETURNING id
            """,
            owner_id,
        )
        notebook_id = await connection.fetchval(
            """
            INSERT INTO notebooks (name, content, owner_id)
            VALUES ('Notebook', '{}'::json, $1)
            RETURNING id
            """,
            owner_id,
        )
        dashboard_id = await connection.fetchval(
            """
            INSERT INTO dashboards (name, layout, owner_id)
            VALUES ('Dashboard', '{}'::json, $1)
            RETURNING id
            """,
            owner_id,
        )
        return dataset_id, notebook_id, dashboard_id
    finally:
        await connection.close()


def test_concurrent_notebook_updates_detect_stale_writer() -> None:
    def body(direct_url: str, async_url: str) -> None:
        _, notebook_id, _ = asyncio.run(_seed_records(direct_url))

        async def verify() -> None:
            engine = create_async_engine(async_url)
            maker = async_sessionmaker(engine, expire_on_commit=False)
            try:
                async with maker() as first, maker() as second:
                    first_notebook = await first.get(Notebook, notebook_id)
                    second_notebook = await second.get(Notebook, notebook_id)

                    assert first_notebook is not None
                    assert second_notebook is not None
                    assert first_notebook.version == second_notebook.version == 1

                    first_notebook.name = "First writer"
                    await first.commit()
                    assert first_notebook.version == 2

                    second_notebook.name = "Stale second writer"
                    with pytest.raises(StaleDataError):
                        await second.commit()
                    await second.rollback()
            finally:
                await engine.dispose()

        asyncio.run(verify())

    _with_database(body)


def test_concurrent_dashboard_updates_detect_stale_writer() -> None:
    def body(direct_url: str, async_url: str) -> None:
        _, _, dashboard_id = asyncio.run(_seed_records(direct_url))

        async def verify() -> None:
            engine = create_async_engine(async_url)
            maker = async_sessionmaker(engine, expire_on_commit=False)
            try:
                async with maker() as first, maker() as second:
                    first_dashboard = await first.get(Dashboard, dashboard_id)
                    second_dashboard = await second.get(Dashboard, dashboard_id)

                    assert first_dashboard is not None
                    assert second_dashboard is not None

                    first_dashboard.name = "First writer"
                    await first.commit()

                    second_dashboard.name = "Stale second writer"
                    with pytest.raises(StaleDataError):
                        await second.commit()
                    await second.rollback()
            finally:
                await engine.dispose()

        asyncio.run(verify())

    _with_database(body)


def test_dataset_update_delete_race_detects_stale_delete() -> None:
    def body(direct_url: str, async_url: str) -> None:
        dataset_id, _, _ = asyncio.run(_seed_records(direct_url))

        async def verify() -> None:
            engine = create_async_engine(async_url)
            maker = async_sessionmaker(engine, expire_on_commit=False)
            try:
                async with maker() as updater, maker() as deleter:
                    update_dataset = await updater.get(Dataset, dataset_id)
                    delete_dataset = await deleter.get(Dataset, dataset_id)

                    assert update_dataset is not None
                    assert delete_dataset is not None

                    update_dataset.name = "Updated first"
                    await updater.commit()

                    await deleter.delete(delete_dataset)
                    with pytest.raises(StaleDataError):
                        await deleter.commit()
                    await deleter.rollback()
            finally:
                await engine.dispose()

        asyncio.run(verify())

    _with_database(body)
