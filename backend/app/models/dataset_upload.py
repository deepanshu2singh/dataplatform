"""Durable upload intents serialize completion and cancellation across workers."""
from sqlalchemy import (
    CheckConstraint, Column, DateTime, ForeignKey, Index, Integer, String, Text,
)
from sqlalchemy.sql import func

from app.db.session import Base


class DatasetUpload(Base):
    __tablename__ = "dataset_uploads"
    __table_args__ = (
        CheckConstraint("expected_size > 0", name="ck_dataset_upload_size_positive"),
        CheckConstraint(
            "status IN ('pending', 'completed', 'cancelled', 'expired')",
            name="ck_dataset_upload_status",
        ),
        CheckConstraint(
            "(status = 'completed') OR dataset_id IS NULL",
            name="ck_dataset_upload_reference",
        ),
        Index("ix_dataset_uploads_expiry", "status", "expires_at"),
    )

    id = Column(String(32), primary_key=True)
    owner_id = Column(Integer, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True)
    object_key = Column(String(1024), nullable=False, unique=True)
    bucket = Column(String(255), nullable=False)
    original_filename = Column(String(255), nullable=False)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    expected_size = Column(Integer, nullable=False)
    status = Column(String(16), nullable=False, default="pending", server_default="pending")
    expires_at = Column(DateTime(timezone=True), nullable=False)
    dataset_id = Column(Integer, ForeignKey("datasets.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
