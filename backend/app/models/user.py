from sqlalchemy import Boolean, CheckConstraint, Column, DateTime, Integer, String, Text, false, true
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.session import Base
from app.core.config import settings


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint(
            "char_length(email) > 0 AND email = lower(btrim(email))",
            name="ck_users_email_normalized",
        ),
        CheckConstraint(
            "char_length(btrim(hashed_password)) > 0",
            name="ck_users_hashed_password_nonblank",
        ),
        CheckConstraint("session_version >= 0", name="ck_users_session_version"),
        CheckConstraint("security_attempts BETWEEN 0 AND 5", name="ck_users_security_attempts"),
        CheckConstraint("email_verification_attempts BETWEEN 0 AND 5", name="ck_users_email_verification_attempts"),
        CheckConstraint("email_verification_window_count >= 0", name="ck_users_email_verification_window_count"),
    )

    id = Column(Integer, primary_key=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    full_name = Column(String(255), nullable=True)
    is_active = Column(
        Boolean,
        nullable=False,
        default=True,
        server_default=true(),
    )
    is_superuser = Column(
        Boolean,
        nullable=False,
        default=False,
        server_default=false(),
    )
    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    session_version = Column(Integer, nullable=False, default=0, server_default="0")
    security_attempts = Column(Integer, nullable=False, default=0, server_default="0")
    security_window_started_at = Column(DateTime(timezone=True), nullable=True)

    email_verified_at = Column(DateTime(timezone=True), nullable=True)
    email_verification_nonce = Column(String(32), nullable=True)
    email_verification_digest = Column(String(64), nullable=True)
    email_verification_expires_at = Column(DateTime(timezone=True), nullable=True)
    email_verification_last_sent_at = Column(DateTime(timezone=True), nullable=True)
    email_verification_attempts = Column(Integer, nullable=False, default=0, server_default="0")
    email_verification_window_started_at = Column(DateTime(timezone=True), nullable=True)
    email_verification_window_count = Column(Integer, nullable=False, default=0, server_default="0")

    @property
    def email_verified(self) -> bool:
        return self.email_verified_at is not None

    @property
    def email_verification_required(self) -> bool:
        return settings.EMAIL_VERIFICATION_REQUIRED

    # Parent deletion is deliberately database-restricted. Dataset file cleanup
    # cannot be made transactional with a blind database cascade, so user
    # deletion must go through an explicit application workflow in the future.
    datasets = relationship(
        "Dataset",
        back_populates="owner",
        passive_deletes="all",
    )
    notebooks = relationship(
        "Notebook",
        back_populates="owner",
        passive_deletes="all",
    )
    dashboards = relationship(
        "Dashboard",
        back_populates="owner",
        passive_deletes="all",
    )
