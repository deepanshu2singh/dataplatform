from __future__ import annotations

import asyncio
import os
from pathlib import Path
import subprocess
from urllib.parse import urlsplit, urlunsplit
from uuid import uuid4

import asyncpg

APP_TABLES = {"users", "datasets", "notebooks", "dashboards"}
HEAD_REVISION = "20261006_0004"
BACKEND_ROOT = Path(__file__).resolve().parents[1]


def _test_database_parts() -> tuple[str, str, str]:
    base_url = os.environ["TEST_DATABASE_URL"]
    parsed = urlsplit(base_url)
    admin_url = urlunsplit((parsed.scheme, parsed.netloc, "/postgres", "", ""))
    database_name = f"migration_{uuid4().hex[:16]}"
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


def _run_alembic(async_database_url: str, *args: str) -> subprocess.CompletedProcess[str]:
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


async def _table_names(database_url: str) -> set[str]:
    connection = await asyncpg.connect(database_url)
    try:
        rows = await connection.fetch(
            "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
        )
        return {row["tablename"] for row in rows}
    finally:
        await connection.close()


async def _version(database_url: str) -> str | None:
    connection = await asyncpg.connect(database_url)
    try:
        exists = await connection.fetchval(
            "SELECT to_regclass('public.alembic_version') IS NOT NULL"
        )
        if not exists:
            return None
        return await connection.fetchval("SELECT version_num FROM alembic_version")
    finally:
        await connection.close()


async def _dataset_enum_exists(database_url: str) -> bool:
    connection = await asyncpg.connect(database_url)
    try:
        return bool(
            await connection.fetchval(
                "SELECT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'datasettype')"
            )
        )
    finally:
        await connection.close()


def _with_database(test_body) -> None:
    admin_url, direct_url, async_url = _test_database_parts()
    database_name = urlsplit(direct_url).path.lstrip("/")
    asyncio.run(_create_database(admin_url, database_name))
    try:
        test_body(direct_url, async_url)
    finally:
        asyncio.run(_drop_database(admin_url, database_name))


def test_fresh_database_upgrades_to_head() -> None:
    def body(direct_url: str, async_url: str) -> None:
        result = _run_alembic(async_url, "upgrade", "head")
        assert result.returncode == 0, result.stderr
        assert APP_TABLES <= asyncio.run(_table_names(direct_url))
        assert asyncio.run(_version(direct_url)) == HEAD_REVISION
        assert asyncio.run(_dataset_enum_exists(direct_url)) is True

    _with_database(body)


def test_migration_matches_current_orm_metadata() -> None:
    def body(_direct_url: str, async_url: str) -> None:
        upgrade = _run_alembic(async_url, "upgrade", "head")
        assert upgrade.returncode == 0, upgrade.stderr

        check = _run_alembic(async_url, "check")
        assert check.returncode == 0, check.stderr or check.stdout

    _with_database(body)


def test_existing_unversioned_legacy_schema_is_adopted_without_data_loss() -> None:
    def body(direct_url: str, async_url: str) -> None:
        # Build the historical baseline schema, then remove Alembic's marker to
        # reproduce a real pre-Alembic installation. Using current ORM metadata
        # here would incorrectly include columns introduced by later revisions.
        baseline = _run_alembic(async_url, "upgrade", "20261006_0001")
        assert baseline.returncode == 0, baseline.stderr

        async def seed_and_forget_version() -> None:
            connection = await asyncpg.connect(direct_url)
            try:
                await connection.execute("DROP TABLE alembic_version")
                await connection.execute(
                    """
                    INSERT INTO users (
                        email, hashed_password, is_active, is_superuser
                    )
                    VALUES ($1, $2, $3, $4)
                    """,
                    "legacy@example.com",
                    "legacy-hash",
                    True,
                    False,
                )
            finally:
                await connection.close()

        asyncio.run(seed_and_forget_version())

        result = _run_alembic(async_url, "upgrade", "head")
        assert result.returncode == 0, result.stderr
        assert asyncio.run(_version(direct_url)) == HEAD_REVISION

        async def read_email() -> str | None:
            connection = await asyncpg.connect(direct_url)
            try:
                return await connection.fetchval(
                    "SELECT email FROM users WHERE email = $1",
                    "legacy@example.com",
                )
            finally:
                await connection.close()

        assert asyncio.run(read_email()) == "legacy@example.com"

    _with_database(body)


def test_partial_legacy_schema_fails_closed() -> None:
    def body(direct_url: str, async_url: str) -> None:
        async def make_partial() -> None:
            connection = await asyncpg.connect(direct_url)
            try:
                await connection.execute(
                    "CREATE TABLE users (id SERIAL PRIMARY KEY, email VARCHAR(255))"
                )
            finally:
                await connection.close()

        asyncio.run(make_partial())
        result = _run_alembic(async_url, "upgrade", "head")

        assert result.returncode != 0
        combined = f"{result.stdout}\n{result.stderr}"
        assert "partial application schema" in combined
        assert "datasets" not in asyncio.run(_table_names(direct_url))

    _with_database(body)


def test_downgrade_to_base_removes_fresh_schema() -> None:
    def body(direct_url: str, async_url: str) -> None:
        upgrade = _run_alembic(async_url, "upgrade", "head")
        assert upgrade.returncode == 0, upgrade.stderr

        downgrade = _run_alembic(async_url, "downgrade", "base")
        assert downgrade.returncode == 0, downgrade.stderr

        assert not (APP_TABLES & asyncio.run(_table_names(direct_url)))
        assert asyncio.run(_dataset_enum_exists(direct_url)) is False

    _with_database(body)
