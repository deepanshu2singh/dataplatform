"""Add durable private dataset upload intents.

Revision ID: 20261011_0005
Revises: 20261006_0004
"""
from alembic import op
import sqlalchemy as sa

revision = "20261011_0005"
down_revision = "20261006_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "dataset_uploads",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("owner_id", sa.Integer(), nullable=False),
        sa.Column("object_key", sa.String(1024), nullable=False),
        sa.Column("bucket", sa.String(255), nullable=False),
        sa.Column("original_filename", sa.String(255), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("expected_size", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(16), server_default="pending", nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("dataset_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("expected_size > 0", name="ck_dataset_upload_size_positive"),
        sa.CheckConstraint("status IN ('pending', 'completed', 'cancelled', 'expired')", name="ck_dataset_upload_status"),
        sa.CheckConstraint("(status = 'completed') OR dataset_id IS NULL", name="ck_dataset_upload_reference"),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["dataset_id"], ["datasets.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("object_key"),
    )
    op.create_index("ix_dataset_uploads_owner_id", "dataset_uploads", ["owner_id"])
    op.create_index("ix_dataset_uploads_expiry", "dataset_uploads", ["status", "expires_at"])


def downgrade() -> None:
    op.drop_table("dataset_uploads")
