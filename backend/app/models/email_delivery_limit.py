from sqlalchemy import CheckConstraint, Column, DateTime, Integer, String

from app.db.session import Base


class EmailDeliveryLimit(Base):
    """Two bounded, shared counters; never an in-memory serverless limiter."""

    __tablename__ = "email_delivery_limits"
    __table_args__ = (CheckConstraint("count >= 0", name="ck_email_delivery_limits_count"),)

    key = Column(String(40), primary_key=True)
    window_started_at = Column(DateTime(timezone=True), nullable=False)
    count = Column(Integer, nullable=False, default=0, server_default="0")
