"""DDL stays additive; populated upgrade and constraints run on disposable PG."""
import asyncio
import importlib.util
import io
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
import asyncpg

from test_migrations import _with_database, _run_alembic


def test_security_migration_is_additive_without_changing_passwords_or_verification():
    path=Path(__file__).parents[1]/'alembic/versions/20261017_0007_account_security.py'
    spec=importlib.util.spec_from_file_location('security_migration',path)
    migration=importlib.util.module_from_spec(spec);spec.loader.exec_module(migration)
    assert migration.down_revision=='20261016_0006'
    output=io.StringIO()
    context=MigrationContext.configure(url='postgresql://',opts={'as_sql':True,'output_buffer':output})
    with Operations.context(context):migration.upgrade()
    sql=output.getvalue()
    assert 'ADD COLUMN session_version INTEGER DEFAULT 0 NOT NULL' in sql
    assert 'ADD COLUMN security_attempts INTEGER DEFAULT 0 NOT NULL' in sql
    assert 'UPDATE users' not in sql and 'DROP ' not in sql


def test_populated_0006_upgrade_preserves_identity_and_checks_then_test_downgrade():
    def body(direct_url,async_url):
        initial=_run_alembic(async_url,'upgrade','20261016_0006')
        assert initial.returncode==0,initial.stderr
        async def seed():
            db=await asyncpg.connect(direct_url)
            try:await db.execute("INSERT INTO users(email,hashed_password,full_name,email_verified_at) VALUES('security-migration@example.com','unchanged-hash','Existing Name',now())")
            finally:await db.close()
        asyncio.run(seed())
        migrated=_run_alembic(async_url,'upgrade','head');assert migrated.returncode==0,migrated.stderr
        async def inspect():
            db=await asyncpg.connect(direct_url)
            try:
                row=await db.fetchrow("SELECT * FROM users WHERE email='security-migration@example.com'")
                assert row['session_version']==0 and row['security_attempts']==0 and row['security_window_started_at'] is None
                assert row['hashed_password']=='unchanged-hash' and row['full_name']=='Existing Name' and row['email_verified_at'] is not None
                for clause in ['session_version=-1','security_attempts=-1','security_attempts=6']:
                    try:await db.execute('UPDATE users SET '+clause)
                    except asyncpg.CheckViolationError:pass
                    else:raise AssertionError('Constraint did not reject '+clause)
            finally:await db.close()
        asyncio.run(inspect())
        check=_run_alembic(async_url,'check');assert check.returncode==0,check.stderr
        down=_run_alembic(async_url,'downgrade','20261016_0006');assert down.returncode==0,down.stderr
        up=_run_alembic(async_url,'upgrade','head');assert up.returncode==0,up.stderr
    _with_database(body)
