"""Baseline the existing application schema.

Revision ID: 20261006_0001
Revises:
Create Date: 2026-10-06

This first migration is deliberately adoption-aware. Existing installations were
created with SQLAlchemy ``metadata.create_all()`` before Alembic was introduced.
If all four expected application tables are already present and structurally
compatible, the migration performs no table DDL; Alembic then records this
revision normally. A partial or incompatible legacy schema fails closed instead
of being silently stamped.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "20261006_0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_EXPECTED_COLUMNS: Mapping[str, set[str]] = {
    "users": {
        "id",
        "email",
        "hashed_password",
        "full_name",
        "is_active",
        "is_superuser",
        "created_at",
        "updated_at",
    },
    "datasets": {
        "id",
        "name",
        "description",
        "type",
        "config",
        "schema_info",
        "owner_id",
        "created_at",
        "updated_at",
    },
    "notebooks": {
        "id",
        "name",
        "description",
        "content",
        "owner_id",
        "created_at",
        "updated_at",
    },
    "dashboards": {
        "id",
        "name",
        "description",
        "layout",
        "owner_id",
        "is_public",
        "created_at",
        "updated_at",
    },
}


def _has_expected_owner_fk(inspector: sa.Inspector, table_name: str) -> bool:
    for fk in inspector.get_foreign_keys(table_name):
        if (
            fk.get("constrained_columns") == ["owner_id"]
            and fk.get("referred_table") == "users"
            and fk.get("referred_columns") == ["id"]
        ):
            return True
    return False


def _has_unique_email(inspector: sa.Inspector) -> bool:
    for index in inspector.get_indexes("users"):
        if index.get("unique") and index.get("column_names") == ["email"]:
            return True

    for constraint in inspector.get_unique_constraints("users"):
        if constraint.get("column_names") == ["email"]:
            return True

    return False


def _validate_and_detect_legacy_schema(bind) -> bool:
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())
    expected_tables = set(_EXPECTED_COLUMNS)
    existing_app_tables = existing_tables & expected_tables

    if not existing_app_tables:
        return False

    if existing_app_tables != expected_tables:
        missing = sorted(expected_tables - existing_app_tables)
        present = sorted(existing_app_tables)
        raise RuntimeError(
            "Refusing to baseline a partial application schema. "
            f"Present application tables: {present}; missing: {missing}."
        )

    for table_name, expected_columns in _EXPECTED_COLUMNS.items():
        actual_columns = {
            column["name"] for column in inspector.get_columns(table_name)
        }
        if actual_columns != expected_columns:
            missing = sorted(expected_columns - actual_columns)
            unexpected = sorted(actual_columns - expected_columns)
            raise RuntimeError(
                f"Refusing to baseline incompatible table {table_name!r}. "
                f"Missing columns: {missing}; unexpected columns: {unexpected}."
            )

        pk = inspector.get_pk_constraint(table_name).get("constrained_columns") or []
        if pk != ["id"]:
            raise RuntimeError(
                f"Refusing to baseline {table_name!r}: expected primary key ['id'], "
                f"found {pk}."
            )

    for owned_table in ("datasets", "notebooks", "dashboards"):
        if not _has_expected_owner_fk(inspector, owned_table):
            raise RuntimeError(
                f"Refusing to baseline {owned_table!r}: expected owner_id -> users.id "
                "foreign key is missing."
            )

    if not _has_unique_email(inspector):
        raise RuntimeError(
            "Refusing to baseline 'users': email must have a unique constraint/index."
        )

    return True


def upgrade() -> None:
    bind = op.get_bind()

    # Existing pre-Alembic installations are adopted without modifying their
    # application tables. Alembic itself records this revision after upgrade()
    # returns successfully.
    if _validate_and_detect_legacy_schema(bind):
        return

    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("hashed_password", sa.String(length=255), nullable=False),
        sa.Column("full_name", sa.String(length=255), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=True),
        sa.Column("is_superuser", sa.Boolean(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=True,
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_users_email"), "users", ["email"], unique=True)
    op.create_index(op.f("ix_users_id"), "users", ["id"], unique=False)

    dataset_type = postgresql.ENUM(
        "FILE",
        "DATABASE",
        "S3",
        name="datasettype",
        create_type=False,
    )
    dataset_type.create(bind, checkfirst=True)

    op.create_table(
        "datasets",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("type", dataset_type, nullable=False),
        sa.Column("config", sa.JSON(), nullable=False),
        sa.Column("schema_info", sa.JSON(), nullable=True),
        sa.Column("owner_id", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_datasets_id"), "datasets", ["id"], unique=False)
    op.create_index(
        op.f("ix_datasets_owner_id"), "datasets", ["owner_id"], unique=False
    )

    op.create_table(
        "notebooks",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("content", sa.JSON(), nullable=False),
        sa.Column("owner_id", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_notebooks_id"), "notebooks", ["id"], unique=False)
    op.create_index(
        op.f("ix_notebooks_owner_id"), "notebooks", ["owner_id"], unique=False
    )

    op.create_table(
        "dashboards",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("layout", sa.JSON(), nullable=False),
        sa.Column("owner_id", sa.Integer(), nullable=False),
        sa.Column("is_public", sa.Boolean(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_dashboards_id"), "dashboards", ["id"], unique=False)
    op.create_index(
        op.f("ix_dashboards_owner_id"), "dashboards", ["owner_id"], unique=False
    )


def downgrade() -> None:
    bind = op.get_bind()

    op.drop_index(op.f("ix_dashboards_owner_id"), table_name="dashboards")
    op.drop_index(op.f("ix_dashboards_id"), table_name="dashboards")
    op.drop_table("dashboards")

    op.drop_index(op.f("ix_notebooks_owner_id"), table_name="notebooks")
    op.drop_index(op.f("ix_notebooks_id"), table_name="notebooks")
    op.drop_table("notebooks")

    op.drop_index(op.f("ix_datasets_owner_id"), table_name="datasets")
    op.drop_index(op.f("ix_datasets_id"), table_name="datasets")
    op.drop_table("datasets")

    dataset_type = postgresql.ENUM(
        "FILE",
        "DATABASE",
        "S3",
        name="datasettype",
        create_type=False,
    )
    dataset_type.drop(bind, checkfirst=True)

    op.drop_index(op.f("ix_users_id"), table_name="users")
    op.drop_index(op.f("ix_users_email"), table_name="users")
    op.drop_table("users")
