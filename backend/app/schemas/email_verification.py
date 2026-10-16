from typing import Literal

from pydantic import BaseModel, Field


class EmailVerificationCode(BaseModel):
    code: str = Field(pattern=r"^[0-9]{8}$", min_length=8, max_length=8)


class EmailVerificationDelivery(BaseModel):
    status: Literal["sent", "already_verified"]
    retry_after_seconds: int = 60
    expires_in_seconds: int = 600
