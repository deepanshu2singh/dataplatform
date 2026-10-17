"""Separate allow-listed inputs; no identity or permission changes."""
import unicodedata

from pydantic import BaseModel, ConfigDict, Field, field_validator


class SecurityReauthentication(BaseModel):
    model_config = ConfigDict(extra="forbid")
    current_password: str = Field(min_length=1, max_length=128)

    @field_validator("current_password")
    @classmethod
    def valid_password_text(cls, value: str) -> str:
        if any(unicodedata.category(c) == "Cs" for c in value):
            raise ValueError("Invalid password text")
        # Passwords are never trimmed or normalized.
        return value


class PasswordChange(SecurityReauthentication):
    new_password: str = Field(min_length=8, max_length=128)

    @field_validator("new_password")
    @classmethod
    def valid_new_password_text(cls, value: str) -> str:
        return cls.valid_password_text(value)
