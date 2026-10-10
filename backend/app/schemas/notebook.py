import json
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


MAX_NOTEBOOK_CELLS = 100
MAX_CELL_CONTENT_CHARS = 50_000
MAX_NOTEBOOK_CONTENT_BYTES = 512 * 1024
MAX_NOTEBOOK_DESCRIPTION_CHARS = 5_000


class NotebookCell(BaseModel):
    id: str = Field(min_length=1, max_length=128)
    type: Literal["sql", "python", "markdown"]
    content: str = Field(default="", max_length=MAX_CELL_CONTENT_CHARS)

    @field_validator("id")
    @classmethod
    def normalize_id(cls, value: str) -> str:
        clean_value = value.strip()

        if not clean_value:
            raise ValueError("Cell id cannot be empty.")

        return clean_value


class NotebookContent(BaseModel):
    dataset_id: int | None = Field(default=None, gt=0)
    cells: list[NotebookCell] = Field(
        default_factory=list,
        max_length=MAX_NOTEBOOK_CELLS,
    )

    @model_validator(mode="after")
    def validate_content(self) -> "NotebookContent":
        cell_ids = [cell.id for cell in self.cells]

        if len(cell_ids) != len(set(cell_ids)):
            raise ValueError("Notebook cell ids must be unique.")

        serialized = json.dumps(
            self.model_dump(mode="json"),
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")

        if len(serialized) > MAX_NOTEBOOK_CONTENT_BYTES:
            raise ValueError(
                "Notebook content exceeds the 512 KB V1 limit."
            )

        return self


class NotebookCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(
        default=None,
        max_length=MAX_NOTEBOOK_DESCRIPTION_CHARS,
    )
    content: NotebookContent = Field(default_factory=NotebookContent)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        clean_value = value.strip()

        if not clean_value:
            raise ValueError("Notebook name is required.")

        return clean_value

    @field_validator("description")
    @classmethod
    def normalize_description(cls, value: str | None) -> str | None:
        if value is None:
            return None

        return value.strip() or None


class NotebookUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(
        default=None,
        max_length=MAX_NOTEBOOK_DESCRIPTION_CHARS,
    )
    content: NotebookContent | None = None

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str | None) -> str | None:
        if value is None:
            return None

        clean_value = value.strip()

        if not clean_value:
            raise ValueError("Notebook name is required.")

        return clean_value

    @field_validator("description")
    @classmethod
    def normalize_description(cls, value: str | None) -> str | None:
        if value is None:
            return None

        return value.strip() or None

    @model_validator(mode="after")
    def reject_explicit_null_required_fields(self) -> "NotebookUpdate":
        if "name" in self.model_fields_set and self.name is None:
            raise ValueError("Notebook name cannot be null.")

        if "content" in self.model_fields_set and self.content is None:
            raise ValueError("Notebook content cannot be null.")

        return self


class NotebookRead(BaseModel):
    id: int
    name: str
    description: str | None = None
    content: NotebookContent
    owner_id: int
    created_at: datetime
    updated_at: datetime | None = None

    model_config = {"from_attributes": True}
