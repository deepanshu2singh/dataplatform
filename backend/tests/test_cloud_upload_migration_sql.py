"""Offline PostgreSQL DDL only; does not replace live migration checks."""
import importlib.util
import io
from pathlib import Path
from alembic.migration import MigrationContext
from alembic.operations import Operations


def test_additive_upload_migration_renders_postgres_ddl():
    path = Path(__file__).parents[1]/"alembic/versions/20261011_0005_dataset_upload_intents.py"
    spec = importlib.util.spec_from_file_location("cloud_upload_migration",path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    assert migration.down_revision == "20261006_0004"
    output = io.StringIO()
    context = MigrationContext.configure(url="postgresql://",opts={"as_sql":True,"output_buffer":output})
    with Operations.context(context): migration.upgrade()
    sql = output.getvalue()
    assert "CREATE TABLE dataset_uploads" in sql
    assert "ON DELETE SET NULL" in sql and "ON DELETE RESTRICT" in sql
    assert "UNIQUE (object_key)" in sql and "TIMESTAMP WITH TIME ZONE" in sql
    assert "ck_dataset_upload_status" in sql and "ix_dataset_uploads_expiry" in sql
    output.seek(0); output.truncate()
    with Operations.context(context): migration.downgrade()
    assert output.getvalue().strip() == "DROP TABLE dataset_uploads;"
