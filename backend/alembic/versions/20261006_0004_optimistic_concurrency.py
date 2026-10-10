"""Add optimistic concurrency versions for mutable owned resources.

Revision ID: 20261006_0004
Revises: 20261006_0003
Create Date: 2026-10-06

Datasets, notebooks, and dashboards are edited through read-modify-write API
flows. Without a row version, two requests that load the same row can silently
overwrite one another. SQLAlchemy's version_id_col turns those updates/deletes
into compare-and-swap operations: only the request holding the current version
may commit.

The version column is intentionally internal to the persistence layer. Existing
frontend payloads do not change; every request receives the version when the ORM
loads the row. A concurrent stale mutation becomes a controlled HTTP 409.

The migration is adoption-aware for schemas created from current ORM metadata.
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261006_0004"
down_revision: Union[str, None] = "20261006_0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_VERSIONED_TABLES = ("datasets", "notebooks", "dashboards")


def _columns(bind, table_name: str) -> dict[str, dict]:
    inspector = sa.inspect(bind)
    return {
        column["name"]: column
        for column in inspector.get_columns(table_name)
    }


def _check_names(bind, table_name: str) -> set[str]:
    inspector = sa.inspect(bind)
    return {
        constraint["name"]
        for constraint in inspector.get_check_constraints(table_name)
        if constraint.get("name")
    }


def _validate_existing_version_column(bind, table_name: str) -> None:
    column = _columns(bind, table_name).get("version")
    if column is None:
        return

    if not isinstance(column["type"], sa.Integer) or column.get("nullable", True):
        raise RuntimeError(
            "Refusing optimistic-concurrency migration: "
            f"{table_name}.version exists with an incompatible definition."
        )

    invalid_rows = bind.execute(
        sa.text(
            f'SELECT count(*) FROM "{table_name}" '
            "WHERE version IS NULL OR version < 1"
        )
    ).scalar_one()

    if invalid_rows:
        raise RuntimeError(
            "Refusing optimistic-concurrency migration: "
            f"{table_name}.version contains invalid values."
        )


def upgrade() -> None:
    bind = op.get_bind()

    for table_name in _VERSIONED_TABLES:
        existing_columns = _columns(bind, table_name)

        if "version" not in existing_columns:
            op.add_column(
                table_name,
                sa.Column(
                    "version",
                    sa.Integer(),
                    nullable=False,
                    server_default=sa.text("1"),
                ),
            )
        else:
            _validate_existing_version_column(bind, table_name)

        check_name = f"ck_{table_name}_version_positive"

        if check_name not in _check_names(bind, table_name):
            op.create_check_constraint(
                check_name,
                table_name,
                "version >= 1",
            )


def downgrade() -> None:
    bind = op.get_bind()

    for table_name in _VERSIONED_TABLES:
        check_name = f"ck_{table_name}_version_positive"

        if check_name in _check_names(bind, table_name):
            op.drop_constraint(
                check_name,
                table_name,
                type_="check",
            )

        if "version" in _columns(bind, table_name):
            op.drop_column(table_name, "version")
