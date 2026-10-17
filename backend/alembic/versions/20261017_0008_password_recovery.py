"""Add purpose-bound password recovery without changing account verification."""
from alembic import op
import sqlalchemy as sa

revision = "20261017_0008"
down_revision = "20261017_0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("password_reset_nonce", sa.String(32), nullable=True))
    op.add_column("users", sa.Column("password_reset_digest", sa.String(64), nullable=True))
    op.add_column("users", sa.Column("password_reset_expires_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("password_reset_last_sent_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("password_reset_attempts", sa.Integer(), nullable=False, server_default=sa.text("0")))
    op.add_column("users", sa.Column("password_reset_window_started_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("password_reset_window_count", sa.Integer(), nullable=False, server_default=sa.text("0")))
    op.create_check_constraint("ck_users_password_reset_attempts", "users", "password_reset_attempts BETWEEN 0 AND 5")
    op.create_check_constraint("ck_users_password_reset_window_count", "users", "password_reset_window_count BETWEEN 0 AND 5")


def downgrade() -> None:
    # Disposable native-test reversibility only. Keep 0007 revocation enforcement.
    op.drop_constraint("ck_users_password_reset_window_count", "users", type_="check")
    op.drop_constraint("ck_users_password_reset_attempts", "users", type_="check")
    for name in ("password_reset_window_count", "password_reset_window_started_at", "password_reset_attempts", "password_reset_last_sent_at", "password_reset_expires_at", "password_reset_digest", "password_reset_nonce"):
        op.drop_column("users", name)
