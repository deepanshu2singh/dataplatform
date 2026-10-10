"""Harden database-level data integrity invariants.

Revision ID: 20261006_0002
Revises: 20261006_0001
Create Date: 2026-10-06

This migration is deliberately fail-closed. It validates all existing rows before
adding stricter constraints. If historical data violates an invariant, no repair
is attempted automatically and the migration aborts before changing the schema.
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261006_0002"
down_revision: Union[str, None] = "20261006_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_CHECKS: dict[str, tuple[tuple[str, str], ...]] = {
    "users": (
        (
            "ck_users_email_normalized",
            "char_length(email) > 0 AND email = lower(btrim(email))",
        ),
        (
            "ck_users_hashed_password_nonblank",
            "char_length(btrim(hashed_password)) > 0",
        ),
    ),
    "datasets": (
        (
            "ck_datasets_name_nonblank",
            "char_length(btrim(name)) > 0",
        ),
        (
            "ck_datasets_config_object",
            "json_typeof(config) = 'object'",
        ),
        (
            "ck_datasets_schema_info_object",
            "schema_info IS NULL OR json_typeof(schema_info) = 'object'",
        ),
    ),
    "notebooks": (
        (
            "ck_notebooks_name_nonblank",
            "char_length(btrim(name)) > 0",
        ),
        (
            "ck_notebooks_content_object",
            "json_typeof(content) = 'object'",
        ),
    ),
    "dashboards": (
        (
            "ck_dashboards_name_nonblank",
            "char_length(btrim(name)) > 0",
        ),
        (
            "ck_dashboards_layout_object",
            "json_typeof(layout) = 'object'",
        ),
        (
            "ck_dashboards_public_disabled",
            "is_public = false",
        ),
    ),
}


_PREFLIGHT_QUERIES: tuple[tuple[str, str], ...] = (
    (
        "users.email must be non-empty, trimmed, and lowercase",
        """
        SELECT count(*) FROM users
        WHERE char_length(email) = 0 OR email <> lower(btrim(email))
        """,
    ),
    (
        "users.hashed_password must be non-empty",
        """
        SELECT count(*) FROM users
        WHERE char_length(btrim(hashed_password)) = 0
        """,
    ),
    (
        "users.is_active must not be NULL",
        "SELECT count(*) FROM users WHERE is_active IS NULL",
    ),
    (
        "users.is_superuser must not be NULL",
        "SELECT count(*) FROM users WHERE is_superuser IS NULL",
    ),
    (
        "users.created_at must not be NULL",
        "SELECT count(*) FROM users WHERE created_at IS NULL",
    ),
    (
        "datasets.name must not be blank",
        "SELECT count(*) FROM datasets WHERE char_length(btrim(name)) = 0",
    ),
    (
        "datasets.config must be a JSON object",
        "SELECT count(*) FROM datasets WHERE json_typeof(config) IS DISTINCT FROM 'object'",
    ),
    (
        "datasets.schema_info must be NULL or a JSON object",
        """
        SELECT count(*) FROM datasets
        WHERE schema_info IS NOT NULL
          AND json_typeof(schema_info) IS DISTINCT FROM 'object'
        """,
    ),
    (
        "notebooks.name must not be blank",
        "SELECT count(*) FROM notebooks WHERE char_length(btrim(name)) = 0",
    ),
    (
        "notebooks.content must be a JSON object",
        "SELECT count(*) FROM notebooks WHERE json_typeof(content) IS DISTINCT FROM 'object'",
    ),
    (
        "dashboards.name must not be blank",
        "SELECT count(*) FROM dashboards WHERE char_length(btrim(name)) = 0",
    ),
    (
        "dashboards.layout must be a JSON object",
        "SELECT count(*) FROM dashboards WHERE json_typeof(layout) IS DISTINCT FROM 'object'",
    ),
    (
        "dashboards.is_public must remain false while public sharing is disabled",
        "SELECT count(*) FROM dashboards WHERE is_public IS DISTINCT FROM false",
    ),
)


def _validate_existing_rows(bind) -> None:
    violations: list[str] = []

    for label, query in _PREFLIGHT_QUERIES:
        count = int(bind.execute(sa.text(query)).scalar_one())
        if count:
            violations.append(f"{label}: {count} row(s)")

    if violations:
        details = "; ".join(violations)
        raise RuntimeError(
            "Refusing data-integrity migration because existing data violates "
            f"the new invariants. No automatic repair was attempted. {details}"
        )


def _existing_check_names(bind, table_name: str) -> set[str]:
    inspector = sa.inspect(bind)
    return {
        constraint["name"]
        for constraint in inspector.get_check_constraints(table_name)
        if constraint.get("name")
    }


def _create_checks_if_missing(bind) -> None:
    for table_name, checks in _CHECKS.items():
        existing = _existing_check_names(bind, table_name)
        for name, condition in checks:
            if name not in existing:
                op.create_check_constraint(name, table_name, condition)
                existing.add(name)


def _drop_checks_if_present(bind) -> None:
    for table_name, checks in _CHECKS.items():
        existing = _existing_check_names(bind, table_name)
        for name, _condition in reversed(checks):
            if name in existing:
                op.drop_constraint(name, table_name, type_="check")
                existing.remove(name)


def upgrade() -> None:
    bind = op.get_bind()
    _validate_existing_rows(bind)

    # User API responses and authentication logic assume these values are
    # always concrete booleans/timestamps. Database defaults also make direct
    # inserts fail safe instead of creating NULL state.
    op.alter_column(
        "users",
        "is_active",
        existing_type=sa.Boolean(),
        nullable=False,
        server_default=sa.true(),
    )
    op.alter_column(
        "users",
        "is_superuser",
        existing_type=sa.Boolean(),
        nullable=False,
        server_default=sa.false(),
    )
    op.alter_column(
        "users",
        "created_at",
        existing_type=sa.DateTime(timezone=True),
        nullable=False,
        existing_server_default=sa.text("now()"),
    )

    # Public sharing remains intentionally disabled. A database default keeps
    # direct inserts aligned with the API's private-by-default behavior.
    op.alter_column(
        "dashboards",
        "is_public",
        existing_type=sa.Boolean(),
        nullable=False,
        server_default=sa.false(),
    )

    _create_checks_if_missing(bind)


def downgrade() -> None:
    bind = op.get_bind()
    _drop_checks_if_present(bind)

    op.alter_column(
        "dashboards",
        "is_public",
        existing_type=sa.Boolean(),
        nullable=False,
        server_default=None,
    )
    op.alter_column(
        "users",
        "created_at",
        existing_type=sa.DateTime(timezone=True),
        nullable=True,
        existing_server_default=sa.text("now()"),
    )
    op.alter_column(
        "users",
        "is_superuser",
        existing_type=sa.Boolean(),
        nullable=True,
        server_default=None,
    )
    op.alter_column(
        "users",
        "is_active",
        existing_type=sa.Boolean(),
        nullable=True,
        server_default=None,
    )
