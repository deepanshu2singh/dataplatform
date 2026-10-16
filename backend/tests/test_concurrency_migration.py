from __future__ import annotations

import asyncio
import os
from pathlib import Path
import subprocess
from urllib.parse import urlsplit, urlunsplit
from uuid import uuid4

import asyncpg
import pytest


PREVIOUS_REVISION = "20261006_0003"
HEAD_REVISION = "20261016_0006"
BACKEND_ROOT = Path(__file__).resolve().parents[1]
VERSIONED_TABLES = ("datasets", "notebooks", "dashboards")


def _test_database_parts() -> tuple[str, str, str]:
    base_url = os.environ["TEST_DATABASE_URL"]
    parsed = urlsplit(base_url)
    admin_url = urlunsplit((parsed.scheme, parsed.netloc, "/postgres", "", ""))
    database_name = f"concurrency_migration_{uuid4().hex[:16]}"
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
        test_body(direct_url, async_url)
    finally:
        asyncio.run(_drop_database(admin_url, database_name))


async def _version(database_url: str) -> str | None:
    connection = await asyncpg.connect(database_url)
    try:
        return await connection.fetchval("SELECT version_num FROM alembic_version")
    finally:
        await connection.close()


async def _version_contract(database_url: str) -> dict[str, tuple[bool, str | None, bool]]:
    connection = await asyncpg.connect(database_url)
    try:
        rows = await connection.fetch(
            """
            SELECT
                c.table_name,
                (c.is_nullable = 'NO') AS not_null,
                c.column_default,
                EXISTS (
                    SELECT 1
                    FROM pg_constraint pc
                    WHERE pc.conrelid = c.table_name::regclass
                      AND pc.conname = ('ck_' || c.table_name || '_version_positive')
                ) AS has_positive_check
            FROM information_schema.columns c
            WHERE c.table_schema = 'public'
              AND c.column_name = 'version'
              AND c.table_name = ANY($1::text[])
            ORDER BY c.table_name
            """,
            list(VERSIONED_TABLES),
        )
        return {
            row["table_name"]: (
                row["not_null"],
                row["column_default"],
                row["has_positive_check"],
            )
            for row in rows
        }
    finally:
        await connection.close()


def test_head_adds_internal_version_contract() -> None:
    def body(direct_url: str, async_url: str) -> None:
        upgrade = _run_alembic(async_url, "upgrade", "head")
        assert upgrade.returncode == 0, upgrade.stderr
        assert asyncio.run(_version(direct_url)) == HEAD_REVISION

        contract = asyncio.run(_version_contract(direct_url))
        assert set(contract) == set(VERSIONED_TABLES)

        for not_null, default, has_positive_check in contract.values():
            assert not_null is True
            assert default is not None
            assert "1" in default
            assert has_positive_check is True

    _with_database(body)


def test_existing_rows_upgrade_with_version_one_and_no_data_loss() -> None:
    def body(direct_url: str, async_url: str) -> None:
        previous = _run_alembic(async_url, "upgrade", PREVIOUS_REVISION)
        assert previous.returncode == 0, previous.stderr

        async def seed() -> tuple[int, int, int]:
            connection = await asyncpg.connect(direct_url)
            try:
                owner_id = await connection.fetchval(
                    """
                    INSERT INTO users (email, hashed_password)
                    VALUES ('version-owner@example.com', 'hash')
                    RETURNING id
                    """
                )
                dataset_id = await connection.fetchval(
                    """
                    INSERT INTO datasets (name, type, config, owner_id)
                    VALUES ('Data', 'FILE', '{}'::json, $1)
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

        dataset_id, notebook_id, dashboard_id = asyncio.run(seed())

        upgrade = _run_alembic(async_url, "upgrade", "head")
        assert upgrade.returncode == 0, upgrade.stderr
        assert asyncio.run(_version(direct_url)) == HEAD_REVISION

        async def verify() -> tuple[int, int, int]:
            connection = await asyncpg.connect(direct_url)
            try:
                return (
                    await connection.fetchval(
                        "SELECT version FROM datasets WHERE id = $1",
                        dataset_id,
                    ),
                    await connection.fetchval(
                        "SELECT version FROM notebooks WHERE id = $1",
                        notebook_id,
                    ),
                    await connection.fetchval(
                        "SELECT version FROM dashboards WHERE id = $1",
                        dashboard_id,
                    ),
                )
            finally:
                await connection.close()

        assert asyncio.run(verify()) == (1, 1, 1)

    _with_database(body)


def test_database_rejects_non_positive_versions() -> None:
    def body(direct_url: str, async_url: str) -> None:
        upgrade = _run_alembic(async_url, "upgrade", "head")
        assert upgrade.returncode == 0, upgrade.stderr

        async def verify() -> None:
            connection = await asyncpg.connect(direct_url)
            try:
                owner_id = await connection.fetchval(
                    """
                    INSERT INTO users (email, hashed_password)
                    VALUES ('bad-version@example.com', 'hash')
                    RETURNING id
                    """
                )

                with pytest.raises(asyncpg.CheckViolationError):
                    await connection.execute(
                        """
                        INSERT INTO notebooks
                            (name, content, owner_id, version)
                        VALUES ('Bad version', '{}'::json, $1, 0)
                        """,
                        owner_id,
                    )
            finally:
                await connection.close()

        asyncio.run(verify())

    _with_database(body)


def test_downgrade_to_previous_revision_removes_version_contract() -> None:
    def body(direct_url: str, async_url: str) -> None:
        upgrade = _run_alembic(async_url, "upgrade", "head")
        assert upgrade.returncode == 0, upgrade.stderr

        downgrade = _run_alembic(
            async_url,
            "downgrade",
            PREVIOUS_REVISION,
        )
        assert downgrade.returncode == 0, downgrade.stderr
        assert asyncio.run(_version(direct_url)) == PREVIOUS_REVISION
        assert asyncio.run(_version_contract(direct_url)) == {}

    _with_database(body)
