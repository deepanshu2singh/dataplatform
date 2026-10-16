"""Add email verification and durable delivery limits without verifying legacy users."""
from alembic import op
import sqlalchemy as sa

revision = "20261016_0006"
down_revision = "20261011_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for name in (
        "email_verified_at", "email_verification_expires_at",
        "email_verification_last_sent_at", "email_verification_window_started_at",
    ):
        op.add_column("users", sa.Column(name, sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("email_verification_nonce", sa.String(32), nullable=True))
    op.add_column("users", sa.Column("email_verification_digest", sa.String(64), nullable=True))
    for name in ("email_verification_attempts", "email_verification_window_count"):
        op.add_column("users", sa.Column(name, sa.Integer(), nullable=False, server_default=sa.text("0")))
    op.create_check_constraint("ck_users_email_verification_attempts", "users", "email_verification_attempts BETWEEN 0 AND 5")
    op.create_check_constraint("ck_users_email_verification_window_count", "users", "email_verification_window_count >= 0")
    op.create_table(
        "email_delivery_limits",
        sa.Column("key", sa.String(40), primary_key=True),
        sa.Column("window_started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.CheckConstraint("count >= 0", name="ck_email_delivery_limits_count"),
    )


def downgrade() -> None:
    op.drop_table("email_delivery_limits")
    op.drop_constraint("ck_users_email_verification_window_count", "users", type_="check")
    op.drop_constraint("ck_users_email_verification_attempts", "users", type_="check")
    for name in (
        "email_verification_window_count", "email_verification_attempts",
        "email_verification_digest", "email_verification_nonce",
        "email_verification_window_started_at", "email_verification_last_sent_at",
        "email_verification_expires_at", "email_verified_at",
    ):
        op.drop_column("users", name)
