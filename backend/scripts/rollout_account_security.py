"""Guarded Supabase 0006 -> 0007 preflight; --apply explicitly runs the migration.

DATABASE_URL stays in the process environment, never in CLI arguments/output.
This helper is not part of the normal application startup path.
"""
import argparse
import asyncio
import os
from pathlib import Path
import sys

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core.config import settings

BASELINE = "20261016_0006"
TARGET = "20261017_0007"
PROJECT = "ckjkgsojwtzbiyqxbtdx"
BACKEND = Path(__file__).resolve().parents[1]


def validate_project_url(value: str) -> None:
    url = make_url(value)
    if url.drivername != "postgresql+asyncpg":
        raise ValueError("Expected async PostgreSQL driver")
    host = (url.host or "").lower()
    # Supabase direct DB and project-scoped pooler usernames are both supported.
    direct = host == f"db.{PROJECT}.supabase.co" and url.username == "postgres"
    pooler = host.endswith(".pooler.supabase.com") and url.username == f"postgres.{PROJECT}"
    if not (direct or pooler) or url.database != "postgres":
        raise ValueError("Connection is not the reviewed Supabase project")


async def read_revision() -> str:
    engine = create_async_engine(settings.DATABASE_URL, poolclass=NullPool, echo=False)
    try:
        async with engine.connect() as connection:
            if (await connection.execute(text("SELECT current_schema()"))).scalar_one() != "public":
                raise ValueError("Unexpected schema")
            revision = (await connection.execute(text("SELECT version_num FROM alembic_version"))).scalar_one()
            if revision not in {BASELINE, TARGET}:
                raise ValueError("Unexpected database revision")
            if revision == TARGET:
                columns = set((await connection.execute(text("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='users'"))).scalars())
                if not {"session_version", "security_attempts", "security_window_started_at"} <= columns:
                    raise ValueError("Security columns missing")
            return revision
    finally:
        await engine.dispose()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Apply reviewed additive 0007 only after preflight passes")
    args = parser.parse_args()
    try:
        validate_project_url(settings.DATABASE_URL)
        config = Config(str(BACKEND / "alembic.ini"))
        config.set_main_option("script_location", str(BACKEND / "alembic"))
        if ScriptDirectory.from_config(config).get_current_head() != TARGET:
            raise ValueError("Unexpected source migration head")
        before = asyncio.run(read_revision())
        print("SUPABASE_PROJECT_CONNECTION=PASS")
        print(f"DATABASE_REVISION_BEFORE={before}")
        if not args.apply:
            print("DATABASE_CHANGES=NONE")
            return 0
        if before == BASELINE:
            previous = Path.cwd()
            try:
                os.chdir(BACKEND)
                command.upgrade(config, TARGET)
            finally:
                os.chdir(previous)
        after = asyncio.run(read_revision())
        if after != TARGET:
            raise ValueError("Migration target not confirmed")
        print(f"DATABASE_REVISION_AFTER={after}")
        print("SETTINGS_SECURITY_DATABASE_MIGRATION=PASS")
        return 0
    except Exception as exc:
        # Never stringify connection exceptions or submitted connection strings.
        print("SETTINGS_SECURITY_DATABASE_CHECK=FAIL")
        print(f"ERROR_TYPE={type(exc).__name__}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
