from sqlalchemy import Boolean, CheckConstraint, Column, DateTime, Integer, String, Text, false, true
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.session import Base


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
