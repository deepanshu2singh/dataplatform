import enum

from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    Enum as SQLEnum,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
    text,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.session import Base


class DatasetType(str, enum.Enum):
    FILE = "file"
    DATABASE = "database"
    S3 = "s3"


class Dataset(Base):
    __tablename__ = "datasets"
    __table_args__ = (
        CheckConstraint(
            "char_length(btrim(name)) > 0",
            name="ck_datasets_name_nonblank",
        ),
        CheckConstraint(
            "json_typeof(config) = 'object'",
            name="ck_datasets_config_object",
        ),
        CheckConstraint(
            "schema_info IS NULL OR json_typeof(schema_info) = 'object'",
            name="ck_datasets_schema_info_object",
        ),
        CheckConstraint(
            "version >= 1",
            name="ck_datasets_version_positive",
        ),
    )

    id = Column(Integer, primary_key=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    type = Column(SQLEnum(DatasetType), nullable=False)
    config = Column(JSON, nullable=False)
    schema_info = Column(JSON, nullable=True)
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

    owner = relationship("User", back_populates="datasets")
