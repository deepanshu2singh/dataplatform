from datetime import datetime
from enum import Enum
from typing import Any, Dict, Optional

from pydantic import BaseModel, Field


class DatasetType(str, Enum):
    FILE = "file"
    DATABASE = "database"
    S3 = "s3"


class DatasetCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: Optional[str] = None
    type: DatasetType
    config: Dict[str, Any] = Field(default_factory=dict)


class DatasetUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    description: Optional[str] = None


class DatasetRead(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    type: DatasetType
    schema_info: Optional[Dict[str, Any]] = None
    owner_id: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}

class DatasetPythonExport(BaseModel):
    dataset_id: int
    dataset_name: str
    csv_text: str
    source_row_count: Optional[int] = None
    loaded_row_count: int
    truncated: bool
    row_limit: int

