"""Profile validation and auth/CSRF boundaries without a network database."""
from datetime import datetime, timezone
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.api.deps import get_current_user
from app.core.config import settings
from app.db.session import get_db
from app.main import app
from app.models.user import User
from app.schemas.user import UserProfileUpdate


@pytest.mark.parametrize("name,expected", [("  Deepanshu Singh  ", "Deepanshu Singh"), ("दीपांशु सिंह", "दीपांशु सिंह"), ("", None), ("   ", None), (None, None)])
def test_profile_normalizes_optional_unicode_names(name, expected):
    assert UserProfileUpdate(full_name=name, expected_full_name=None).full_name == expected


@pytest.mark.parametrize("name", ["a" * 256, "A\nB", "A\x00B", "A\tB", 123])
def test_profile_rejects_invalid_names(name):
    with pytest.raises(ValidationError):
        UserProfileUpdate(full_name=name, expected_full_name=None)


@pytest.fixture()
def profile_client(monkeypatch):
    monkeypatch.setattr(settings, "EMAIL_VERIFICATION_REQUIRED", True)
    now = datetime.now(timezone.utc)
    user = User(id=42, email="profile@example.com", full_name="Original Name", hashed_password="PRIVATE_HASH", is_active=True, is_superuser=False, email_verified_at=now, created_at=now)
    db = AsyncMock()
    result = Mock()
    result.scalar_one_or_none.return_value = user.id
    db.execute.return_value = result
    saved_name = ["Saved Name"]

    async def refresh(account):
        account.full_name = saved_name[0]
    db.refresh.side_effect = refresh

    async def get_test_db():
        yield db
    app.dependency_overrides[get_db] = get_test_db
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        with TestClient(app) as client:
            yield client, user, db, result, saved_name
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_current_user, None)


def patch_profile(client, **payload):
    return client.patch("/api/v1/auth/me", headers={"Origin": settings.FRONTEND_URL}, json={"full_name": "Saved Name", "expected_full_name": "Original Name", **payload})


def test_profile_returns_saved_identity_without_private_fields(profile_client):
    client, user, db, _, _ = profile_client
    response = patch_profile(client)
    assert response.status_code == 200
    assert response.json()["full_name"] == "Saved Name"
    assert response.json()["email"] == user.email and response.json()["email_verified"] is True
    assert "PRIVATE_HASH" not in response.text and "hashed_password" not in response.text
    assert response.headers["cache-control"] == "no-store"
    db.commit.assert_awaited_once()
    statement = db.execute.call_args.args[0]
    parameters = statement.compile().params
    assert parameters["id_1"] == user.id


@pytest.mark.parametrize("field,value", [("email", "other@example.com"), ("password", "Hacked123!"), ("is_active", False), ("is_superuser", True), ("email_verified", True), ("email_verified_at", "2026-01-01"), ("id", 99)])
def test_profile_cannot_mass_assign_identity_privileges_or_verification(profile_client, field, value):
    client, _, db, _, _ = profile_client
    response = patch_profile(client, **{field: value})
    assert response.status_code == 422
    db.execute.assert_not_awaited()
    db.commit.assert_not_awaited()


def test_conflict_rolls_back_without_overwriting(profile_client):
    client, _, db, result, _ = profile_client
    result.scalar_one_or_none.return_value = None
    response = patch_profile(client)
    assert response.status_code == 409 and "edits are kept" in response.json()["detail"]
    db.rollback.assert_awaited_once()
    db.commit.assert_not_awaited()


@pytest.mark.parametrize("origin", [None, "https://untrusted.example"])
def test_profile_requires_trusted_origin(profile_client, origin):
    client, _, db, _, _ = profile_client
    response = client.patch("/api/v1/auth/me", headers={"Origin": origin} if origin else {}, json={"full_name": "Saved Name", "expected_full_name": "Original Name"})
    assert response.status_code == 403
    db.commit.assert_not_awaited()


def test_pending_and_inactive_accounts_cannot_edit_profile(profile_client):
    client, user, db, _, _ = profile_client
    user.email_verified_at = None
    response = patch_profile(client)
    assert response.status_code == 403 and response.headers["X-Email-Verification-Required"] == "true"
    user.is_active = False
    assert patch_profile(client).status_code == 403
    db.commit.assert_not_awaited()


def test_unauthenticated_profile_edit_is_rejected(profile_client):
    client, _, db, _, _ = profile_client
    app.dependency_overrides.pop(get_current_user)
    assert patch_profile(client).status_code == 401
    db.commit.assert_not_awaited()


def test_missing_expected_snapshot_is_rejected(profile_client):
    client, _, db, _, _ = profile_client
    response = client.patch("/api/v1/auth/me", headers={"Origin": settings.FRONTEND_URL}, json={"full_name": "Saved Name"})
    assert response.status_code == 422
    db.commit.assert_not_awaited()
