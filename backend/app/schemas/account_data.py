"""Export requests never accept a user identifier or arbitrary storage location."""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt

Category = Literal["datasets", "notebooks", "dashboards", "uploads"]


class ExportProof(BaseModel):
    model_config = ConfigDict(extra="forbid")
    proof: str = Field(min_length=1, max_length=2048)


class ExportCatalog(ExportProof):
    category: Category
    after: str | None = Field(default=None, min_length=1, max_length=32)


class ExportRecord(ExportProof):
    category: Category
    record_id: str = Field(min_length=1, max_length=32)
    revision: str = Field(min_length=1, max_length=64)
    offset: StrictInt = Field(default=0, ge=0, le=32 * 1024 * 1024)


class ExportDatasetFile(ExportProof):
    dataset_id: StrictInt = Field(gt=0)

