import pytest
import traceback
from fastapi import Response
from pydantic import ValidationError

from app.core.config import (
    DEFAULT_DEVELOPMENT_SECRET,
    Settings,
)
from app.core import security


STRONG_SECRET = "phase8b4-production-secret-" + ("A9" * 24)


def make_settings(**overrides) -> Settings:
    values = {
        "ENVIRONMENT": "development",
        "SECRET_KEY": "development-secret-value-1234567890",
        "FRONTEND_URL": "http://localhost:5173",
    }
    values.update(overrides)
    return Settings(_env_file=None, **values)


def test_development_config_normalizes_origin_and_keeps_cookie_non_secure() -> None:
    config = make_settings(
        ENVIRONMENT=" DEVELOPMENT ",
        FRONTEND_URL="HTTP://LOCALHOST:5173/",
    )

    assert config.ENVIRONMENT == "development"
    assert config.FRONTEND_URL == "http://localhost:5173"
    assert config.auth_cookie_secure is False


def test_production_accepts_strong_https_cookie_configuration() -> None:
    config = make_settings(
        ENVIRONMENT="production",
        SECRET_KEY=STRONG_SECRET,
        FRONTEND_URL="https://app.example.com/",
        AUTH_COOKIE_SECURE=True,
    )

    assert config.FRONTEND_URL == "https://app.example.com"
    assert config.auth_cookie_secure is True


def test_production_rejects_default_development_secret() -> None:
    with pytest.raises(ValidationError, match="Production SECRET_KEY"):
        make_settings(
            ENVIRONMENT="production",
            SECRET_KEY=DEFAULT_DEVELOPMENT_SECRET,
            FRONTEND_URL="https://app.example.com",
            AUTH_COOKIE_SECURE=True,
        )


def test_production_rejects_http_frontend_origin() -> None:
    with pytest.raises(ValidationError, match="Production FRONTEND_URL must use HTTPS"):
        make_settings(
            ENVIRONMENT="production",
            SECRET_KEY=STRONG_SECRET,
            FRONTEND_URL="http://app.example.com",
            AUTH_COOKIE_SECURE=True,
        )


def test_production_rejects_explicitly_insecure_cookie() -> None:
    with pytest.raises(ValidationError, match="AUTH_COOKIE_SECURE=true"):
        make_settings(
            ENVIRONMENT="production",
            SECRET_KEY=STRONG_SECRET,
            FRONTEND_URL="https://app.example.com",
            AUTH_COOKIE_SECURE=False,
        )


def test_samesite_none_requires_secure_cookie() -> None:
    with pytest.raises(ValidationError, match="SameSite=None"):
        make_settings(
            AUTH_COOKIE_SAMESITE="none",
            AUTH_COOKIE_SECURE=False,
        )


def test_session_lifetime_is_bounded() -> None:
    with pytest.raises(ValidationError):
        make_settings(ACCESS_TOKEN_EXPIRE_MINUTES=4)

    with pytest.raises(ValidationError):
        make_settings(ACCESS_TOKEN_EXPIRE_MINUTES=(60 * 24 * 7) + 1)


def test_set_auth_cookie_uses_production_security_attributes(monkeypatch) -> None:
    production = make_settings(
        ENVIRONMENT="production",
        SECRET_KEY=STRONG_SECRET,
        FRONTEND_URL="https://app.example.com",
        AUTH_COOKIE_SECURE=True,
        ACCESS_TOKEN_EXPIRE_MINUTES=30,
    )
    monkeypatch.setattr(security, "settings", production)

    response = Response()
    security.set_auth_cookie(response, "test-session-token")

    set_cookie = response.headers["set-cookie"].lower()
    assert "dataplatform_session=" in set_cookie
    assert "httponly" in set_cookie
    assert "secure" in set_cookie
    assert "samesite=lax" in set_cookie
    assert "path=/api/v1" in set_cookie
    assert "max-age=1800" in set_cookie


def test_short_signing_key_is_rejected_without_rendering_its_value() -> None:
    secret = "SHORT_PRIVATE_KEY"
    with pytest.raises(ValidationError) as captured:
        make_settings(SECRET_KEY=secret)

    rendered = "".join(traceback.format_exception(captured.value))
    assert "SECRET_KEY" in rendered
    assert "at least 32 characters" in rendered
    assert secret not in rendered
    assert "input_value" not in rendered


def test_model_security_error_does_not_render_other_private_settings() -> None:
    database_url = "postgresql+asyncpg://user:PRIVATE_DB_PASSWORD@private.invalid/db"
    with pytest.raises(ValidationError) as captured:
        make_settings(
            ENVIRONMENT="production",
            SECRET_KEY=STRONG_SECRET,
            DATABASE_URL=database_url,
            FRONTEND_URL="http://app.example.com",
        )

    rendered = "".join(traceback.format_exception(captured.value))
    assert "Production FRONTEND_URL must use HTTPS" in rendered
    assert STRONG_SECRET not in rendered
    assert database_url not in rendered
    assert "PRIVATE_DB_PASSWORD" not in rendered
    assert "input_value" not in rendered
