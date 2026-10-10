from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKey, Integer, JSON, String, Text, text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.session import Base


class Notebook(Base):
    __tablename__ = "notebooks"
    __table_args__ = (
        CheckConstraint(
            "char_length(btrim(name)) > 0",
            name="ck_notebooks_name_nonblank",
        ),
        CheckConstraint(
            "json_typeof(content) = 'object'",
            name="ck_notebooks_content_object",
        ),
        CheckConstraint(
            "version >= 1",
            name="ck_notebooks_version_positive",
        ),
    )

    id = Column(Integer, primary_key=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    content = Column(JSON, nullable=False, default=dict)
    owner_id = Column(Integer, ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    version = Column(
        Integer,
        nullable=False,
        default=1,
        server_default=text("1"),
    )

    __mapper_args__ = {"version_id_col": version}

    owner = relationship("User", back_populates="notebooks")
