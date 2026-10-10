from datetime import timedelta

from app.core.security import (
    create_access_token,
    decode_token,
    get_password_hash,
    verify_password,
)


def test_password_hash_round_trip() -> None:
    password = "Correct-Horse-42"
    hashed = get_password_hash(password)

    assert hashed != password
    assert verify_password(password, hashed) is True
    assert verify_password("wrong-password", hashed) is False


def test_access_token_round_trip() -> None:
    token = create_access_token(
        {"sub": "user@example.com"},
        expires_delta=timedelta(minutes=5),
    )

    payload = decode_token(token)

    assert payload is not None
    assert payload["sub"] == "user@example.com"
    assert "exp" in payload


def test_expired_access_token_is_rejected() -> None:
    token = create_access_token(
        {"sub": "expired@example.com"},
        expires_delta=timedelta(seconds=-1),
    )

    assert decode_token(token) is None


def test_malformed_token_is_rejected() -> None:
    assert decode_token("not-a-jwt") is None
