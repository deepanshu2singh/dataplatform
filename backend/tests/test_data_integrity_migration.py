from __future__ import annotations

import asyncio
import os
from pathlib import Path
import subprocess
from urllib.parse import urlsplit, urlunsplit
from uuid import uuid4

import asyncpg
import pytest


BASELINE_REVISION = "20261006_0001"
HEAD_REVISION = "20261017_0008"
BACKEND_ROOT = Path(__file__).resolve().parents[1]
EXPECTED_CHECKS = {
    "ck_users_email_normalized",
    "ck_users_hashed_password_nonblank",
    "ck_datasets_name_nonblank",
    "ck_datasets_config_object",
    "ck_datasets_schema_info_object",
    "ck_notebooks_name_nonblank",
    "ck_notebooks_content_object",
    "ck_dashboards_name_nonblank",
    "ck_dashboards_layout_object",
    "ck_dashboards_public_disabled",
}


def _test_database_parts() -> tuple[str, str, str]:
    base_url = os.environ["TEST_DATABASE_URL"]
    parsed = urlsplit(base_url)
    admin_url = urlunsplit((parsed.scheme, parsed.netloc, "/postgres", "", ""))
    database_name = f"integrity_{uuid4().hex[:16]}"
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
        exists = await connection.fetchval(
            "SELECT to_regclass('public.alembic_version') IS NOT NULL"
        )
        if not exists:
            return None
        return await connection.fetchval("SELECT version_num FROM alembic_version")
    finally:
        await connection.close()


async def _check_names(database_url: str) -> set[str]:
    connection = await asyncpg.connect(database_url)
    try:
        rows = await connection.fetch(
            """
            SELECT conname
            FROM pg_constraint
            WHERE contype = 'c'
              AND connamespace = 'public'::regnamespace
            """
        )
        return {row["conname"] for row in rows}
    finally:
        await connection.close()


async def _column_state(
    database_url: str,
    table_name: str,
    column_name: str,
) -> tuple[str, str | None]:
    connection = await asyncpg.connect(database_url)
    try:
        row = await connection.fetchrow(
            """
            SELECT is_nullable, column_default
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = $1
              AND column_name = $2
            """,
            table_name,
            column_name,
        )
        assert row is not None
        return row["is_nullable"], row["column_default"]
    finally:
        await connection.close()


async def _seed_user(connection: asyncpg.Connection) -> int:
    return await connection.fetchval(
        """
        INSERT INTO users (email, hashed_password, is_active, is_superuser)
        VALUES ('owner@example.com', 'argon2-placeholder', true, false)
        RETURNING id
        """
    )


def test_integrity_upgrade_adds_constraints_and_required_column_state() -> None:
    def body(direct_url: str, async_url: str) -> None:
        result = _run_alembic(async_url, "upgrade", "head")
        assert result.returncode == 0, result.stderr
        assert asyncio.run(_version(direct_url)) == HEAD_REVISION
        assert EXPECTED_CHECKS <= asyncio.run(_check_names(direct_url))

        for column_name in ("is_active", "is_superuser", "created_at"):
            nullable, _default = asyncio.run(
                _column_state(direct_url, "users", column_name)
            )
            assert nullable == "NO"

        dashboard_nullable, dashboard_default = asyncio.run(
            _column_state(direct_url, "dashboards", "is_public")
        )
        assert dashboard_nullable == "NO"
        assert dashboard_default is not None

    _with_database(body)


def test_database_defaults_keep_direct_inserts_safe() -> None:
    def body(direct_url: str, async_url: str) -> None:
        result = _run_alembic(async_url, "upgrade", "head")
        assert result.returncode == 0, result.stderr

        async def verify() -> None:
            connection = await asyncpg.connect(direct_url)
            try:
                user = await connection.fetchrow(
                    """
                    INSERT INTO users (email, hashed_password)
                    VALUES ('defaults@example.com', 'argon2-placeholder')
                    RETURNING id, is_active, is_superuser, created_at
                    """
                )
                assert user["is_active"] is True
                assert user["is_superuser"] is False
                assert user["created_at"] is not None

                is_public = await connection.fetchval(
                    """
                    INSERT INTO dashboards (name, layout, owner_id)
                    VALUES ('Private dashboard', '{"version":1,"widgets":[]}'::json, $1)
                    RETURNING is_public
                    """,
                    user["id"],
                )
                assert is_public is False
            finally:
                await connection.close()

        asyncio.run(verify())

    _with_database(body)


def test_user_integrity_constraints_reject_invalid_rows() -> None:
    def body(direct_url: str, async_url: str) -> None:
        result = _run_alembic(async_url, "upgrade", "head")
        assert result.returncode == 0, result.stderr

        async def verify() -> None:
            connection = await asyncpg.connect(direct_url)
            try:
                with pytest.raises(asyncpg.CheckViolationError):
                    await connection.execute(
                        """
                        INSERT INTO users (email, hashed_password)
                        VALUES ('MixedCase@Example.com', 'argon2-placeholder')
                        """
                    )

                with pytest.raises(asyncpg.CheckViolationError):
                    await connection.execute(
                        """
                        INSERT INTO users (email, hashed_password)
                        VALUES ('blankhash@example.com', '   ')
                        """
                    )

                with pytest.raises(asyncpg.NotNullViolationError):
                    await connection.execute(
                        """
                        INSERT INTO users
                            (email, hashed_password, is_active, is_superuser)
                        VALUES
                            ('nullbool@example.com', 'argon2-placeholder', NULL, false)
                        """
                    )
            finally:
                await connection.close()

        asyncio.run(verify())

    _with_database(body)


def test_entity_names_cannot_be_blank_at_database_boundary() -> None:
    def body(direct_url: str, async_url: str) -> None:
        result = _run_alembic(async_url, "upgrade", "head")
        assert result.returncode == 0, result.stderr

        async def verify() -> None:
            connection = await asyncpg.connect(direct_url)
            try:
                owner_id = await _seed_user(connection)

                with pytest.raises(asyncpg.CheckViolationError):
                    await connection.execute(
                        """
                        INSERT INTO datasets (name, type, config, owner_id)
                        VALUES ('   ', 'FILE', '{}'::json, $1)
                        """,
                        owner_id,
                    )

                with pytest.raises(asyncpg.CheckViolationError):
                    await connection.execute(
                        """
                        INSERT INTO notebooks (name, content, owner_id)
                        VALUES ('   ', '{}'::json, $1)
                        """,
                        owner_id,
                    )

                with pytest.raises(asyncpg.CheckViolationError):
                    await connection.execute(
                        """
                        INSERT INTO dashboards (name, layout, owner_id)
                        VALUES ('   ', '{}'::json, $1)
                        """,
                        owner_id,
                    )
            finally:
                await connection.close()

        asyncio.run(verify())

    _with_database(body)


def test_json_columns_require_object_shapes() -> None:
    def body(direct_url: str, async_url: str) -> None:
        result = _run_alembic(async_url, "upgrade", "head")
        assert result.returncode == 0, result.stderr

        async def verify() -> None:
            connection = await asyncpg.connect(direct_url)
            try:
                owner_id = await _seed_user(connection)

                with pytest.raises(asyncpg.CheckViolationError):
                    await connection.execute(
                        """
                        INSERT INTO datasets (name, type, config, owner_id)
                        VALUES ('Bad config', 'FILE', '[]'::json, $1)
                        """,
                        owner_id,
                    )

                with pytest.raises(asyncpg.CheckViolationError):
                    await connection.execute(
                        """
                        INSERT INTO datasets
                            (name, type, config, schema_info, owner_id)
                        VALUES
                            ('Bad schema', 'FILE', '{}'::json, '[]'::json, $1)
                        """,
                        owner_id,
                    )

                with pytest.raises(asyncpg.CheckViolationError):
                    await connection.execute(
                        """
                        INSERT INTO notebooks (name, content, owner_id)
                        VALUES ('Bad content', '[]'::json, $1)
                        """,
                        owner_id,
                    )

                with pytest.raises(asyncpg.CheckViolationError):
                    await connection.execute(
                        """
                        INSERT INTO dashboards (name, layout, owner_id)
                        VALUES ('Bad layout', '[]'::json, $1)
                        """,
                        owner_id,
                    )
            finally:
                await connection.close()

        asyncio.run(verify())

    _with_database(body)


def test_public_dashboard_cannot_be_enabled_directly() -> None:
    def body(direct_url: str, async_url: str) -> None:
        result = _run_alembic(async_url, "upgrade", "head")
        assert result.returncode == 0, result.stderr

        async def verify() -> None:
            connection = await asyncpg.connect(direct_url)
            try:
                owner_id = await _seed_user(connection)
                with pytest.raises(asyncpg.CheckViolationError):
                    await connection.execute(
                        """
                        INSERT INTO dashboards
                            (name, layout, owner_id, is_public)
                        VALUES
                            ('Public dashboard', '{}'::json, $1, true)
                        """,
                        owner_id,
                    )
            finally:
                await connection.close()

        asyncio.run(verify())

    _with_database(body)


def test_dirty_baseline_database_fails_closed_without_partial_migration() -> None:
    def body(direct_url: str, async_url: str) -> None:
        baseline = _run_alembic(async_url, "upgrade", BASELINE_REVISION)
        assert baseline.returncode == 0, baseline.stderr

        async def seed_dirty_row() -> None:
            connection = await asyncpg.connect(direct_url)
            try:
                await connection.execute(
                    """
                    INSERT INTO users
                        (email, hashed_password, is_active, is_superuser)
                    VALUES
                        ('Dirty@Example.com', 'argon2-placeholder', true, false)
                    """
                )
            finally:
                await connection.close()

        asyncio.run(seed_dirty_row())

        upgrade = _run_alembic(async_url, "upgrade", "head")
        assert upgrade.returncode != 0
        combined = f"{upgrade.stdout}\n{upgrade.stderr}"
        assert "Refusing data-integrity migration" in combined
        assert "users.email" in combined
        assert asyncio.run(_version(direct_url)) == BASELINE_REVISION
        assert "ck_users_email_normalized" not in asyncio.run(
            _check_names(direct_url)
        )

    _with_database(body)


def test_valid_baseline_data_is_preserved_and_downgrade_restores_contract() -> None:
    def body(direct_url: str, async_url: str) -> None:
        baseline = _run_alembic(async_url, "upgrade", BASELINE_REVISION)
        assert baseline.returncode == 0, baseline.stderr

        async def seed() -> None:
            connection = await asyncpg.connect(direct_url)
            try:
                owner_id = await _seed_user(connection)
                await connection.execute(
                    """
                    INSERT INTO datasets
                        (name, type, config, schema_info, owner_id)
                    VALUES
                        ('Sales', 'FILE', '{"file_path":"/tmp/sales.csv"}'::json,
                         '{"columns":[]}'::json, $1)
                    """,
                    owner_id,
                )
                await connection.execute(
                    """
                    INSERT INTO notebooks (name, content, owner_id)
                    VALUES ('Analysis', '{"dataset_id":null,"cells":[]}'::json, $1)
                    """,
                    owner_id,
                )
                await connection.execute(
                    """
                    INSERT INTO dashboards (name, layout, owner_id, is_public)
                    VALUES ('Overview', '{"version":1,"widgets":[]}'::json, $1, false)
                    """,
                    owner_id,
                )
            finally:
                await connection.close()

        asyncio.run(seed())

        upgrade = _run_alembic(async_url, "upgrade", "head")
        assert upgrade.returncode == 0, upgrade.stderr
        assert asyncio.run(_version(direct_url)) == HEAD_REVISION

        async def verify_rows() -> tuple[int, int, int, int]:
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

        assert asyncio.run(verify_rows()) == (1, 1, 1, 1)

        downgrade = _run_alembic(
            async_url,
            "downgrade",
            BASELINE_REVISION,
        )
        assert downgrade.returncode == 0, downgrade.stderr
        assert asyncio.run(_version(direct_url)) == BASELINE_REVISION
        assert not (EXPECTED_CHECKS & asyncio.run(_check_names(direct_url)))

        is_active_nullable, is_active_default = asyncio.run(
            _column_state(direct_url, "users", "is_active")
        )
        assert is_active_nullable == "YES"
        assert is_active_default is None

        dashboard_nullable, dashboard_default = asyncio.run(
            _column_state(direct_url, "dashboards", "is_public")
        )
        assert dashboard_nullable == "NO"
        assert dashboard_default is None

    _with_database(body)
