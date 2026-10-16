from pydantic import ValidationError
import pytest

from app.core.config import Settings


def test_local_storage_remains_default() -> None:
    settings = Settings(_env_file=None)

    assert settings.STORAGE_BACKEND == "local"
    assert settings.SUPABASE_URL is None
    assert settings.SUPABASE_SECRET_KEY is None
    assert settings.SUPABASE_STORAGE_BUCKET == "datasets"


def test_supabase_storage_requires_url() -> None:
    with pytest.raises(
        ValidationError,
        match="SUPABASE_URL is required",
    ):
        Settings(
            _env_file=None,
            STORAGE_BACKEND="supabase",
            SUPABASE_URL=None,
            SUPABASE_SECRET_KEY="dummy-secret",
            SUPABASE_STORAGE_BUCKET="datasets",
        )


def test_supabase_storage_requires_secret_key() -> None:
    with pytest.raises(
        ValidationError,
        match="SUPABASE_SECRET_KEY is required",
    ):
        Settings(
            _env_file=None,
            STORAGE_BACKEND="supabase",
            SUPABASE_URL="https://example.supabase.co",
            SUPABASE_SECRET_KEY=None,
            SUPABASE_STORAGE_BUCKET="datasets",
        )


def test_supabase_storage_rejects_blank_bucket() -> None:
    with pytest.raises(
        ValidationError,
        match="SUPABASE_STORAGE_BUCKET is required",
    ):
        Settings(
            _env_file=None,
            STORAGE_BACKEND="supabase",
            SUPABASE_URL="https://example.supabase.co",
            SUPABASE_SECRET_KEY="dummy-secret",
            SUPABASE_STORAGE_BUCKET="   ",
        )


def test_valid_supabase_storage_configuration() -> None:
    settings = Settings(
        _env_file=None,
        STORAGE_BACKEND="supabase",
        SUPABASE_URL="https://example.supabase.co/",
        SUPABASE_SECRET_KEY="dummy-secret",
        SUPABASE_STORAGE_BUCKET="datasets",
    )

    assert settings.STORAGE_BACKEND == "supabase"
    assert settings.SUPABASE_URL == "https://example.supabase.co"
    assert settings.SUPABASE_STORAGE_BUCKET == "datasets"

    assert settings.SUPABASE_SECRET_KEY is not None
    assert (
        settings.SUPABASE_SECRET_KEY.get_secret_value()
        == "dummy-secret"
    )


def test_supabase_secret_is_masked() -> None:
    settings = Settings(
        _env_file=None,
        STORAGE_BACKEND="supabase",
        SUPABASE_URL="https://example.supabase.co",
        SUPABASE_SECRET_KEY="dummy-secret",
        SUPABASE_STORAGE_BUCKET="datasets",
    )

    assert "dummy-secret" not in repr(settings)
    assert "dummy-secret" not in str(
        settings.SUPABASE_SECRET_KEY
    )
