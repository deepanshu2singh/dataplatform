from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


DEFAULT_DEVELOPMENT_SECRET = "local-development-secret-key-change-me"
MIN_SECRET_LENGTH = 32
MIN_SESSION_MINUTES = 5
MAX_SESSION_MINUTES = 60 * 24 * 7


def _normalize_http_origin(value: str) -> str:
    candidate = value.strip()

    try:
        parsed = urlsplit(candidate)
        port = parsed.port
    except ValueError as exc:
        raise ValueError("must be a valid HTTP(S) origin") from exc

    scheme = parsed.scheme.lower()

    if (
        scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or parsed.path not in {"", "/"}
    ):
        raise ValueError("must be a valid HTTP(S) origin")

    host = parsed.hostname.lower()

    if ":" in host and not host.startswith("["):
        host = f"[{host}]"

    if (
        (scheme == "http" and port == 80)
        or (scheme == "https" and port == 443)
    ):
        port = None

    port_suffix = f":{port}" if port is not None else ""
    return f"{scheme}://{host}{port_suffix}"


class Settings(BaseSettings):
    PROJECT_NAME: str = "DataPlatform"
    API_V1_STR: str = "/api/v1"
    ENVIRONMENT: Literal["development", "test", "production"] = "development"

    SECRET_KEY: str = Field(
        default=DEFAULT_DEVELOPMENT_SECRET,
        min_length=MIN_SECRET_LENGTH,
    )
    ALGORITHM: Literal["HS256"] = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = Field(
        default=60 * 24,
        ge=MIN_SESSION_MINUTES,
        le=MAX_SESSION_MINUTES,
    )

    # Browser sessions use an HttpOnly JWT cookie. Docker development passes
    # AUTH_COOKIE_SECURE=false explicitly; production must explicitly opt in
    # to secure cookies and will fail startup otherwise.
    AUTH_COOKIE_NAME: str = "dataplatform_session"
    AUTH_COOKIE_PATH: str = "/api/v1"
    AUTH_COOKIE_SAMESITE: Literal["lax", "strict", "none"] = "lax"
    AUTH_COOKIE_SECURE: bool | None = None

    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/databricks_clone"
    SQL_ECHO: bool = False
    LOG_LEVEL: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"

    UPLOAD_DIR: str = "./uploads"
    MAX_UPLOAD_SIZE: int = 100 * 1024 * 1024

    FRONTEND_URL: str = "http://localhost:5173"

    @field_validator("LOG_LEVEL", mode="before")
    @classmethod
    def normalize_log_level(cls, value):
        if isinstance(value, str):
            return value.strip().upper()
        return value

    @field_validator("ENVIRONMENT", mode="before")
    @classmethod
    def normalize_environment(cls, value):
        if isinstance(value, str):
            return value.strip().lower()
        return value

    @field_validator("FRONTEND_URL", mode="before")
    @classmethod
    def validate_frontend_url(cls, value):
        if not isinstance(value, str):
            raise ValueError("FRONTEND_URL must be a valid HTTP(S) origin")
        return _normalize_http_origin(value)

    @field_validator("AUTH_COOKIE_PATH")
    @classmethod
    def validate_cookie_path(cls, value: str) -> str:
        if not value.startswith("/") or ";" in value or any(ch.isspace() for ch in value):
            raise ValueError("AUTH_COOKIE_PATH must be an absolute cookie path")
        return value

    @property
    def auth_cookie_secure(self) -> bool:
        if self.AUTH_COOKIE_SECURE is not None:
            return self.AUTH_COOKIE_SECURE
        return self.ENVIRONMENT == "production"

    @model_validator(mode="after")
    def validate_security_configuration(self):
        secret_lower = self.SECRET_KEY.strip().lower()

        if self.ENVIRONMENT == "production":
            insecure_secret_markers = (
                "change-me",
                "changeme",
                "not-for-production",
                "test-secret",
            )

            if (
                self.SECRET_KEY == DEFAULT_DEVELOPMENT_SECRET
                or any(marker in secret_lower for marker in insecure_secret_markers)
            ):
                raise ValueError(
                    "Production SECRET_KEY must be a unique high-entropy secret"
                )

            if not self.FRONTEND_URL.startswith("https://"):
                raise ValueError("Production FRONTEND_URL must use HTTPS")

            if self.AUTH_COOKIE_SECURE is False:
                raise ValueError("Production requires AUTH_COOKIE_SECURE=true")

        if self.AUTH_COOKIE_SAMESITE == "none" and not self.auth_cookie_secure:
            raise ValueError("SameSite=None requires a Secure authentication cookie")

        return self

    model_config = SettingsConfigDict(
        env_file=".env",
        case_sensitive=True,
        extra="ignore",
        validate_default=True,
    )


settings = Settings()
