"""Harden relational ownership semantics and remove redundant indexes.

Revision ID: 20261006_0003
Revises: 20261006_0002
Create Date: 2026-10-06

The application intentionally keeps dataset/notebook references embedded in JSON
as soft references: deleting a dataset or notebook leaves a readable stale
reference that the API reports to the user. This migration therefore does not
invent foreign keys for JSON payloads.

Ownership is different. Every dataset, notebook, and dashboard must have a real
user owner. Parent-user deletion is made explicitly RESTRICT at the database
boundary so a future user-deletion feature cannot silently cascade metadata and
leave uploaded files orphaned.

Primary keys already have PostgreSQL-backed unique indexes, so the separate
ix_*_id indexes created by the pre-Alembic ORM are redundant and are removed.
Owner indexes are retained because the API filters by owner_id on every list and
ownership lookup, and PostgreSQL can use them for FK parent-delete checks.

Like the baseline migrations, the DDL is adoption-aware so a schema created from
current ORM metadata can still be adopted safely.
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261006_0003"
down_revision: Union[str, None] = "20261006_0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_OWNED_TABLES = ("datasets", "notebooks", "dashboards")
_REDUNDANT_PRIMARY_KEY_INDEXES = (
    ("users", "ix_users_id"),
    ("datasets", "ix_datasets_id"),
    ("notebooks", "ix_notebooks_id"),
    ("dashboards", "ix_dashboards_id"),
)


def _index_names(bind, table_name: str) -> set[str]:
    inspector = sa.inspect(bind)
    return {
        index["name"]
        for index in inspector.get_indexes(table_name)
        if index.get("name")
    }


def _find_owner_fk(bind, table_name: str) -> dict:
    inspector = sa.inspect(bind)
    for foreign_key in inspector.get_foreign_keys(table_name):
        if (
            foreign_key.get("constrained_columns") == ["owner_id"]
            and foreign_key.get("referred_table") == "users"
            and foreign_key.get("referred_columns") == ["id"]
        ):
            return foreign_key

    raise RuntimeError(
        f"Refusing relational-integrity migration: {table_name}.owner_id -> "
        "users.id foreign key is missing."
    )


def _owner_fk_delete_action(foreign_key: dict) -> str | None:
    options = foreign_key.get("options") or {}
    value = options.get("ondelete")
    return str(value).upper() if value is not None else None


def _replace_owner_fk(bind, table_name: str, *, ondelete: str | None) -> None:
    foreign_key = _find_owner_fk(bind, table_name)
    current_ondelete = _owner_fk_delete_action(foreign_key)
    target_ondelete = ondelete.upper() if ondelete is not None else None

    # PostgreSQL's default is NO ACTION. SQLAlchemy reflection represents that
    # as a missing ondelete option, which is the state restored by downgrade.
    if current_ondelete == target_ondelete:
        return

    constraint_name = foreign_key.get("name")
    if not constraint_name:
        raise RuntimeError(
            f"Refusing relational-integrity migration: {table_name}.owner_id "
            "foreign key has no stable constraint name."
        )

    op.drop_constraint(
        constraint_name,
        table_name,
        type_="foreignkey",
    )
    op.create_foreign_key(
        constraint_name,
        table_name,
        "users",
        ["owner_id"],
        ["id"],
        ondelete=ondelete,
    )


def upgrade() -> None:
    bind = op.get_bind()

    for table_name, index_name in _REDUNDANT_PRIMARY_KEY_INDEXES:
        if index_name in _index_names(bind, table_name):
            op.drop_index(index_name, table_name=table_name)

    for table_name in _OWNED_TABLES:
        _replace_owner_fk(bind, table_name, ondelete="RESTRICT")


def downgrade() -> None:
    bind = op.get_bind()

    for table_name in _OWNED_TABLES:
        _replace_owner_fk(bind, table_name, ondelete=None)

    for table_name, index_name in _REDUNDANT_PRIMARY_KEY_INDEXES:
        if index_name not in _index_names(bind, table_name):
            op.create_index(index_name, table_name, ["id"], unique=False)
