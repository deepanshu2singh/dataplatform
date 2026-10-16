from __future__ import annotations

import asyncio
import os
from pathlib import Path
import subprocess
from urllib.parse import urlsplit, urlunsplit
from uuid import uuid4

import asyncpg
import pytest


PREVIOUS_REVISION = "20261006_0002"
HEAD_REVISION = "20261011_0005"
BACKEND_ROOT = Path(__file__).resolve().parents[1]
OWNED_TABLES = ("datasets", "notebooks", "dashboards")
REDUNDANT_PK_INDEXES = {
    "ix_users_id",
    "ix_datasets_id",
    "ix_notebooks_id",
    "ix_dashboards_id",
}
OWNER_INDEXES = {
    "ix_datasets_owner_id",
    "ix_notebooks_owner_id",
    "ix_dashboards_owner_id",
}


def _test_database_parts() -> tuple[str, str, str]:
    base_url = os.environ["TEST_DATABASE_URL"]
    parsed = urlsplit(base_url)
    admin_url = urlunsplit((parsed.scheme, parsed.netloc, "/postgres", "", ""))
    database_name = f"relational_{uuid4().hex[:16]}"
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


async def _index_names(database_url: str) -> set[str]:
    connection = await asyncpg.connect(database_url)
    try:
        rows = await connection.fetch(
            """
            SELECT indexname
            FROM pg_indexes
            WHERE schemaname = 'public'
              AND tablename IN ('users', 'datasets', 'notebooks', 'dashboards')
            """
        )
        return {row["indexname"] for row in rows}
    finally:
        await connection.close()


async def _owner_fk_delete_actions(database_url: str) -> dict[str, str]:
    connection = await asyncpg.connect(database_url)
    try:
        rows = await connection.fetch(
            """
            SELECT
                c.conrelid::regclass::text AS table_name,
                c.confdeltype::text AS confdeltype
            FROM pg_constraint c
            WHERE c.contype = 'f'
              AND c.conrelid IN (
                  'datasets'::regclass,
                  'notebooks'::regclass,
                  'dashboards'::regclass
              )
              AND c.confrelid = 'users'::regclass
            """
        )
        return {row["table_name"]: row["confdeltype"] for row in rows}
    finally:
        await connection.close()


async def _seed_user(connection: asyncpg.Connection, email: str = "owner@example.com") -> int:
    return await connection.fetchval(
        """
        INSERT INTO users (email, hashed_password)
        VALUES ($1, 'argon2-placeholder')
        RETURNING id
        """,
        email,
    )


def test_upgrade_removes_redundant_pk_indexes_and_keeps_owner_indexes() -> None:
    def body(direct_url: str, async_url: str) -> None:
        upgrade = _run_alembic(async_url, "upgrade", "head")
        assert upgrade.returncode == 0, upgrade.stderr
        assert asyncio.run(_version(direct_url)) == HEAD_REVISION

        indexes = asyncio.run(_index_names(direct_url))
        assert not (REDUNDANT_PK_INDEXES & indexes)
        assert OWNER_INDEXES <= indexes
        assert {"users_pkey", "datasets_pkey", "notebooks_pkey", "dashboards_pkey"} <= indexes
        assert "ix_users_email" in indexes

    _with_database(body)


def test_owner_foreign_keys_explicitly_restrict_parent_deletion() -> None:
    def body(direct_url: str, async_url: str) -> None:
        upgrade = _run_alembic(async_url, "upgrade", "head")
        assert upgrade.returncode == 0, upgrade.stderr

        # PostgreSQL pg_constraint confdeltype: r = RESTRICT, a = NO ACTION.
        assert asyncio.run(_owner_fk_delete_actions(direct_url)) == {
            "datasets": "r",
            "notebooks": "r",
            "dashboards": "r",
        }

        async def verify() -> None:
            connection = await asyncpg.connect(direct_url)
            try:
                owner_id = await _seed_user(connection)
                await connection.execute(
                    """
                    INSERT INTO datasets (name, type, config, owner_id)
                    VALUES ('Owned data', 'FILE', '{}'::json, $1)
                    """,
                    owner_id,
                )

                with pytest.raises(asyncpg.ForeignKeyViolationError):
                    await connection.execute(
                        "DELETE FROM users WHERE id = $1",
                        owner_id,
                    )

                assert await connection.fetchval(
                    "SELECT count(*) FROM users WHERE id = $1",
                    owner_id,
                ) == 1
            finally:
                await connection.close()

        asyncio.run(verify())

    _with_database(body)


def test_invalid_owner_references_are_rejected_for_all_owned_tables() -> None:
    def body(direct_url: str, async_url: str) -> None:
        upgrade = _run_alembic(async_url, "upgrade", "head")
        assert upgrade.returncode == 0, upgrade.stderr

        async def verify() -> None:
            connection = await asyncpg.connect(direct_url)
            try:
                with pytest.raises(asyncpg.ForeignKeyViolationError):
                    await connection.execute(
                        """
                        INSERT INTO datasets (name, type, config, owner_id)
                        VALUES ('Bad owner', 'FILE', '{}'::json, 999999)
                        """
                    )

                with pytest.raises(asyncpg.ForeignKeyViolationError):
                    await connection.execute(
                        """
                        INSERT INTO notebooks (name, content, owner_id)
                        VALUES ('Bad owner', '{}'::json, 999999)
                        """
                    )

                with pytest.raises(asyncpg.ForeignKeyViolationError):
                    await connection.execute(
                        """
                        INSERT INTO dashboards (name, layout, owner_id)
                        VALUES ('Bad owner', '{}'::json, 999999)
                        """
                    )
            finally:
                await connection.close()

        asyncio.run(verify())

    _with_database(body)


def test_existing_rows_survive_relational_upgrade() -> None:
    def body(direct_url: str, async_url: str) -> None:
        previous = _run_alembic(async_url, "upgrade", PREVIOUS_REVISION)
        assert previous.returncode == 0, previous.stderr

        async def seed_and_count() -> tuple[int, int, int, int]:
            connection = await asyncpg.connect(direct_url)
            try:
                owner_id = await _seed_user(connection)
                await connection.execute(
                    """
                    INSERT INTO datasets (name, type, config, owner_id)
                    VALUES ('Sales', 'FILE', '{}'::json, $1)
                    """,
                    owner_id,
                )
                await connection.execute(
                    """
                    INSERT INTO notebooks (name, content, owner_id)
                    VALUES ('Analysis', '{}'::json, $1)
                    """,
                    owner_id,
                )
                await connection.execute(
                    """
                    INSERT INTO dashboards (name, layout, owner_id)
                    VALUES ('Overview', '{}'::json, $1)
                    """,
                    owner_id,
                )
                return (
                    await connection.fetchval("SELECT count(*) FROM users"),
                    await connection.fetchval("SELECT count(*) FROM datasets"),
                    await connection.fetchval("SELECT count(*) FROM notebooks"),
                    await connection.fetchval("SELECT count(*) FROM dashboards"),
                )
            finally:
                await connection.close()

        before = asyncio.run(seed_and_count())
        upgrade = _run_alembic(async_url, "upgrade", "head")
        assert upgrade.returncode == 0, upgrade.stderr
        assert asyncio.run(_version(direct_url)) == HEAD_REVISION

        async def count() -> tuple[int, int, int, int]:
            connection = await asyncpg.connect(direct_url)
            try:
                return (
                    await connection.fetchval("SELECT count(*) FROM users"),
                    await connection.fetchval("SELECT count(*) FROM datasets"),
                    await connection.fetchval("SELECT count(*) FROM notebooks"),
                    await connection.fetchval("SELECT count(*) FROM dashboards"),
                )
            finally:
                await connection.close()

        assert asyncio.run(count()) == before == (1, 1, 1, 1)

    _with_database(body)


def test_downgrade_restores_previous_fk_and_index_contract() -> None:
    def body(direct_url: str, async_url: str) -> None:
        upgrade = _run_alembic(async_url, "upgrade", "head")
        assert upgrade.returncode == 0, upgrade.stderr

        downgrade = _run_alembic(async_url, "downgrade", PREVIOUS_REVISION)
        assert downgrade.returncode == 0, downgrade.stderr
        assert asyncio.run(_version(direct_url)) == PREVIOUS_REVISION

        indexes = asyncio.run(_index_names(direct_url))
        assert REDUNDANT_PK_INDEXES <= indexes
        assert OWNER_INDEXES <= indexes

        assert asyncio.run(_owner_fk_delete_actions(direct_url)) == {
            "datasets": "a",
            "notebooks": "a",
            "dashboards": "a",
        }

    _with_database(body)
