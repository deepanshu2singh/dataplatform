"""Add account session revocation and durable security reauthentication limits."""
from alembic import op
import sqlalchemy as sa

revision = "20261017_0007"
down_revision = "20261016_0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("session_version", sa.Integer(), nullable=False, server_default=sa.text("0")))
    op.add_column("users", sa.Column("security_attempts", sa.Integer(), nullable=False, server_default=sa.text("0")))
    op.add_column("users", sa.Column("security_window_started_at", sa.DateTime(timezone=True), nullable=True))
    op.create_check_constraint("ck_users_session_version", "users", "session_version >= 0")
    op.create_check_constraint("ck_users_security_attempts", "users", "security_attempts BETWEEN 0 AND 5")


def downgrade() -> None:
    # Test-only reversibility. Production must keep revocation enforcement:
    # removing this version can make previously revoked cookies valid again.
    op.drop_constraint("ck_users_security_attempts", "users", type_="check")
    op.drop_constraint("ck_users_session_version", "users", type_="check")
    op.drop_column("users", "security_window_started_at")
    op.drop_column("users", "security_attempts")
    op.drop_column("users", "session_version")
