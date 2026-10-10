import pytest
from pydantic import ValidationError

from app.api.routes.auth import normalize_email
from app.schemas.user import UserCreate


def test_normalize_email_trims_and_lowercases() -> None:
    assert normalize_email("  Person@Example.COM  ") == "person@example.com"


def test_user_create_rejects_short_password() -> None:
    with pytest.raises(ValidationError):
        UserCreate(
            email="person@example.com",
            password="short",
        )


def test_user_create_accepts_valid_password() -> None:
    user = UserCreate(
        email="person@example.com",
        password="long-enough-password",
        full_name="Example Person",
    )

    assert str(user.email) == "person@example.com"
    assert user.full_name == "Example Person"
