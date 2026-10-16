"""Focused verification tests. Database cases require the disposable TEST_DATABASE_URL."""
import asyncio
from datetime import datetime, timedelta, timezone
import hashlib
import importlib.util
import io
import os
from pathlib import Path
from uuid import uuid4

import httpx
import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi import HTTPException
from pydantic import SecretStr, ValidationError
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import Settings, settings
from app.models.email_delivery_limit import EmailDeliveryLimit
from app.models.user import User
from app.services import email_verification as service


def test_required_verification_rejects_missing_sender_without_secret_disclosure():
    with pytest.raises(ValidationError) as caught:
        Settings(_env_file=None, EMAIL_VERIFICATION_REQUIRED=True, RESEND_API_KEY="PRIVATE_TEST_RESEND_KEY")
    assert "EMAIL_FROM" in str(caught.value)
    assert "PRIVATE_TEST_RESEND_KEY" not in str(caught.value)


def test_codes_are_account_email_and_challenge_bound(monkeypatch):
    monkeypatch.setattr(settings, "SECRET_KEY", "test-only-" * 8)
    left = User(id=1, email="left@example.com")
    right = User(id=2, email="right@example.com")
    first = service._digest(left, "challenge-a", "00001234")
    assert len(first) == 64
    assert first != service._digest(right, "challenge-a", "00001234")
    assert first != service._digest(left, "challenge-b", "00001234")
    assert first != hashlib.sha256(b"00001234").hexdigest()


def test_migration_is_additive_and_does_not_verify_existing_users():
    path = Path(__file__).parents[1] / "alembic/versions/20261016_0006_email_verification.py"
    spec = importlib.util.spec_from_file_location("email_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    assert migration.down_revision == "20261011_0005"
    output = io.StringIO()
    context = MigrationContext.configure(url="postgresql://", opts={"as_sql": True, "output_buffer": output})
    with Operations.context(context):
        migration.upgrade()
    sql = output.getvalue()
    assert "ADD COLUMN email_verified_at TIMESTAMP WITH TIME ZONE" in sql
    assert "CREATE TABLE email_delivery_limits" in sql
    assert "UPDATE users" not in sql and "DROP TABLE" not in sql


def test_invalid_code_input_is_not_echoed_in_validation_response():
    from fastapi.testclient import TestClient
    from app.main import app
    from app.api.deps import get_current_enabled_user
    app.dependency_overrides[get_current_enabled_user] = lambda: User(id=1, email="test@example.com", is_active=True)
    try:
        with TestClient(app) as client:
            response = client.post("/api/v1/auth/email-verification/confirm", headers={"Origin": settings.FRONTEND_URL}, json={"code": "87654321\n"})
        assert response.status_code == 422
        assert "87654321" not in response.text and "input" not in response.text
    finally:
        app.dependency_overrides.pop(get_current_enabled_user, None)


@pytest.mark.parametrize("result", [200, 403, 429, "timeout", "malformed"])
def test_transport_is_scoped_private_and_handles_provider_failures(monkeypatch, caplog, result):
    monkeypatch.setattr(settings, "RESEND_API_KEY", SecretStr("re_PRIVATE_TRANSPORT_TEST"))
    monkeypatch.setattr(settings, "EMAIL_FROM", "no-reply@notify.sprout-sql.com")
    captured = []

    def handler(request):
        import json
        captured.append(request)
        body = json.loads(request.content)
        assert body["to"] == ["recipient@example.com"]
        assert "00001234" in body["text"]
        assert request.headers["Idempotency-Key"] == "email-verification/challenge-a"
        if result == "timeout":
            raise httpx.ReadTimeout("PRIVATE_PROVIDER_BODY", request=request)
        if result == "malformed":
            return httpx.Response(200, text="PRIVATE_PROVIDER_BODY")
        return httpx.Response(result, json={"id": "mail-accepted", "message": "PRIVATE_PROVIDER_BODY"})

    original_client = httpx.AsyncClient
    monkeypatch.setattr(service.httpx, "AsyncClient", lambda **kwargs: original_client(transport=httpx.MockTransport(handler), **kwargs))
    if result == 200:
        asyncio.run(service._deliver_code("recipient@example.com", "00001234", "challenge-a"))
    else:
        with pytest.raises(HTTPException) as caught:
            asyncio.run(service._deliver_code("recipient@example.com", "00001234", "challenge-a"))
        assert caught.value.status_code == 503
        assert "PRIVATE" not in caught.value.detail
    assert len(captured) == 1
    assert "PRIVATE_PROVIDER_BODY" not in caplog.text
    assert "00001234" not in caplog.text and "re_PRIVATE" not in caplog.text


DB_CASES = [
    "gate-and-valid-code", "wrong-attempt-lockout", "expiry", "resend", "cooldown",
    "account-hour-limit", "global-limit", "concurrent-send", "concurrent-confirm",
    "delivery-failure", "old-cookie-and-inactive", "csrf", "wrong-account",
]


@pytest.mark.parametrize("case", DB_CASES)
def test_database_verification_flow(monkeypatch, case):
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("Disposable PostgreSQL TEST_DATABASE_URL required")
    from urllib.parse import urlsplit
    assert "test" in urlsplit(url).path.lower(), "Refusing a non-test database"
    from app.db.session import get_db
    from app.main import app
    from app.core.security import create_access_token

    monkeypatch.setattr(settings, "EMAIL_VERIFICATION_REQUIRED", True)
    monkeypatch.setattr(settings, "RESEND_API_KEY", SecretStr("re_TEST_ONLY_NEVER_SEND"))
    monkeypatch.setattr(settings, "EMAIL_FROM", "no-reply@notify.sprout-sql.com")
    monkeypatch.setattr(settings, "AUTH_COOKIE_SECURE", False)
    now = datetime.now(timezone.utc)
    clock = [now]
    monkeypatch.setattr(service, "_now", lambda: clock[0])
    delivered = []

    async def deliver(email, code, nonce):
        delivered.append((email, code, nonce))
        if case == "delivery-failure":
            raise HTTPException(503, "Delivery unconfirmed")

    monkeypatch.setattr(service, "_deliver_code", deliver)

    async def exercise():
        engine = create_async_engine(url.replace("postgresql://", "postgresql+asyncpg://", 1), poolclass=NullPool)
        sessions = async_sessionmaker(engine, expire_on_commit=False)

        async def database():
            async with sessions() as db:
                try:
                    yield db
                except Exception:
                    await db.rollback()
                    raise

        app.dependency_overrides[get_db] = database
        try:
            async with sessions() as db:
                await db.execute(delete(EmailDeliveryLimit))
                await db.commit()
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://testserver", headers={"Origin": settings.FRONTEND_URL}) as client:
                email = f"verification-{uuid4().hex}@example.com"
                password = "Verification-Test-Password-123!"
                registered = await client.post("/api/v1/auth/register", json={"email": email, "password": password})
                assert registered.status_code == 201, registered.text
                user_id = registered.json()["id"]
                assert registered.json()["email_verified"] is False
                login = await client.post("/api/v1/auth/login", data={"username": email, "password": password})
                assert login.status_code == 204
                me = await client.get("/api/v1/auth/me")
                assert me.status_code == 200 and me.json()["email_verification_required"] is True
                assert "digest" not in me.text and "nonce" not in me.text

                async def send():
                    return await client.post("/api/v1/auth/email-verification/send", json={})

                async def confirm(code):
                    return await client.post("/api/v1/auth/email-verification/confirm", json={"code": code})

                if case == "old-cookie-and-inactive":
                    client.cookies.set(settings.AUTH_COOKIE_NAME, create_access_token({"sub": email}))
                    assert (await client.get("/api/v1/datasets")).status_code == 403
                    async with sessions() as db:
                        user = await db.get(User, user_id); user.is_active = False; await db.commit()
                    assert (await send()).status_code == 403
                    return
                if case == "csrf":
                    response = await client.post("/api/v1/auth/email-verification/send", json={}, headers={"Origin": "https://evil.example"})
                    assert response.status_code == 403 and delivered == []
                    return
                if case == "global-limit":
                    async with sessions() as db:
                        db.add(EmailDeliveryLimit(key="verification-day", window_started_at=now.replace(hour=0, minute=0, second=0, microsecond=0), count=service.MAX_SENDS_PER_DAY))
                        await db.commit()
                    assert (await send()).status_code == 429 and delivered == []
                    return
                if case == "concurrent-send":
                    results = await asyncio.gather(send(), send())
                    assert sorted(r.status_code for r in results) == [200, 429]
                    assert len(delivered) == 1
                    return
                sent = await send()
                if case == "delivery-failure":
                    assert sent.status_code == 503
                    assert (await client.get("/api/v1/datasets")).status_code == 403
                    assert (await send()).status_code == 429
                    # An uncertain delivery may still arrive; that code remains usable.
                    assert (await confirm(delivered[-1][1])).status_code == 200
                    return
                assert sent.status_code == 200, sent.text
                assert "code" not in sent.json() and "nonce" not in sent.json()
                correct = delivered[-1][1]
                async with sessions() as db:
                    user = await db.get(User, user_id)
                    assert user.email_verification_digest != correct
                    assert user.email_verified_at is None
                if case == "cooldown":
                    assert (await send()).status_code == 429 and len(delivered) == 1
                    return
                if case == "wrong-attempt-lockout":
                    wrong = "99999999" if correct != "99999999" else "00000000"
                    for _ in range(5): assert (await confirm(wrong)).status_code == 400
                    assert (await confirm(correct)).status_code == 400
                    async with sessions() as db:
                        user = await db.get(User, user_id)
                        assert user.email_verification_attempts == 5 and user.email_verification_digest is None
                    return
                if case == "expiry":
                    clock[0] += timedelta(seconds=600)
                    assert (await confirm(correct)).status_code == 400
                    return
                if case == "resend":
                    clock[0] += timedelta(seconds=61)
                    assert (await send()).status_code == 200
                    assert delivered[-1][2] != delivered[0][2]
                    if correct != delivered[-1][1]: assert (await confirm(correct)).status_code == 400
                    assert (await confirm(delivered[-1][1])).status_code == 200
                    return
                if case == "account-hour-limit":
                    for _ in range(4):
                        clock[0] += timedelta(seconds=61)
                        assert (await send()).status_code == 200
                    clock[0] += timedelta(seconds=61)
                    assert (await send()).status_code == 429 and len(delivered) == 5
                    return
                if case == "wrong-account":
                    async with sessions() as db:
                        other = User(email=f"other-{uuid4().hex}@example.com", hashed_password="test", is_active=True)
                        db.add(other); await db.commit()
                    client.cookies.clear()
                    client.cookies.set(settings.AUTH_COOKIE_NAME, create_access_token({"sub": other.email}))
                    assert (await confirm(correct)).status_code == 400
                    return
                if case == "concurrent-confirm":
                    results = await asyncio.gather(confirm(correct), confirm(correct))
                    assert [r.status_code for r in results] == [200, 200]
                else:
                    for path in ("/api/v1/datasets", "/api/v1/notebooks", "/api/v1/dashboards"):
                        assert (await client.get(path)).status_code == 403
                    assert (await client.post("/api/v1/sql/query", json={"query": "SELECT 1", "dataset_id": 1})).status_code == 403
                    assert (await confirm("bad")).status_code == 422
                    assert (await confirm(correct)).status_code == 200
                assert (await client.get("/api/v1/auth/me")).json()["email_verified"] is True
                assert (await client.get("/api/v1/datasets")).status_code == 200
                async with sessions() as db:
                    user = await db.get(User, user_id)
                    assert user.email_verification_digest is None and user.email_verification_nonce is None
        finally:
            app.dependency_overrides.pop(get_db, None)
            await engine.dispose()

    asyncio.run(exercise())
