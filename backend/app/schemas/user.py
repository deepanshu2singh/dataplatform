from datetime import datetime
from typing import Optional
import unicodedata

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class UserBase(BaseModel):
    email: EmailStr
    full_name: Optional[str] = None


class UserCreate(UserBase):
    password: str = Field(min_length=8, max_length=128)


class UserUpdate(BaseModel):
    email: Optional[EmailStr] = None
    full_name: Optional[str] = None
    password: Optional[str] = None
    is_active: Optional[bool] = None


class UserProfileUpdate(BaseModel):
    """Self-service profile editing cannot change identity or access flags."""

    model_config = ConfigDict(extra="forbid")
    full_name: str | None = Field(max_length=255)
    expected_full_name: str | None = Field(max_length=255)

    @field_validator("full_name")
    @classmethod
    def normalize_full_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if any(unicodedata.category(character) in {"Cc", "Cs"} for character in value):
            raise ValueError("Use a single-line name without control characters")
        return value.strip() or None


class UserInDBBase(UserBase):
    id: int
    is_active: bool
    is_superuser: bool
    email_verified: bool
    email_verification_required: bool
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class User(UserInDBBase):
    pass


class UserInDB(UserInDBBase):
    hashed_password: str
