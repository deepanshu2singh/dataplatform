"""Anonymous recovery accepts no identity/role/verification mutations."""
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator
from app.schemas.account_security import SecurityReauthentication


class RecoveryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: EmailStr = Field(max_length=255)


class RecoveryConfirm(RecoveryRequest):
    code: str = Field(pattern=r"^[0-9]{8}$", min_length=8, max_length=8)
    new_password: str = Field(min_length=8, max_length=128)

    @field_validator("new_password")
    @classmethod
    def valid_password(cls, value: str) -> str:
        return SecurityReauthentication.valid_password_text(value)
