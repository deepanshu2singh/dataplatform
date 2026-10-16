"""Account-bound email codes with transactional attempts and delivery budgets."""
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import logging
import math
import secrets
from uuid import uuid4

import httpx
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.email_delivery_limit import EmailDeliveryLimit
from app.models.user import User

logger = logging.getLogger(__name__)
CODE_LIFETIME_SECONDS = 600
RESEND_COOLDOWN_SECONDS = 60
MAX_ATTEMPTS = 5
MAX_SENDS_PER_ACCOUNT_HOUR = 5
# Leave room within the provider's free daily allowance for operational email.
MAX_SENDS_PER_DAY = 90
MAX_SENDS_PER_MINUTE = 10


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _digest(user: User, nonce: str, code: str) -> str:
    payload = f"email-verification:{user.id}:{user.email}:{nonce}:{code}"
    return hmac.new(settings.SECRET_KEY.encode(), payload.encode(), hashlib.sha256).hexdigest()


def _rate_limited(seconds: int) -> HTTPException:
    return HTTPException(429, "Please wait before requesting another verification email", headers={"Retry-After": str(max(1, seconds))})


async def _locked_user(db: AsyncSession, user_id: int) -> User:
    # populate_existing avoids stale ORM identity-map values after waiting on a lock.
    user = await db.scalar(
        select(User).where(User.id == user_id).with_for_update().execution_options(populate_existing=True)
    )
    if user is None or not user.is_active:
        raise HTTPException(403, "This account is inactive")
    return user


async def _reserve_delivery_budget(db: AsyncSession, now: datetime) -> None:
    # Constant keys keep the table bounded. Lock order is always day then minute.
    for key, window, limit in (
        ("verification-day", now.replace(hour=0, minute=0, second=0, microsecond=0), MAX_SENDS_PER_DAY),
        ("verification-minute", now.replace(second=0, microsecond=0), MAX_SENDS_PER_MINUTE),
    ):
        await db.execute(insert(EmailDeliveryLimit).values(key=key, window_started_at=window, count=0).on_conflict_do_nothing(index_elements=["key"]))
        bucket = await db.scalar(select(EmailDeliveryLimit).where(EmailDeliveryLimit.key == key).with_for_update().execution_options(populate_existing=True))
        # A slightly older worker clock must never reset a newer shared window.
        if bucket.window_started_at < window:
            bucket.window_started_at = window
            bucket.count = 0
        if bucket.count >= limit:
            raise _rate_limited(60 if key.endswith("minute") else 3600)
        bucket.count += 1


async def _deliver_code(email: str, code: str, nonce: str) -> None:
    """Only this transport sees a plaintext code; never return/log provider bodies."""
    if settings.RESEND_API_KEY is None or settings.EMAIL_FROM is None:
        raise HTTPException(503, "Email delivery is not configured")
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=5.0), follow_redirects=False) as client:
            response = await client.post(
                "https://api.resend.com/emails",
                headers={
                    "Authorization": f"Bearer {settings.RESEND_API_KEY.get_secret_value()}",
                    "Idempotency-Key": f"email-verification/{nonce}",
                },
                json={
                    "from": f"Data Platform <{settings.EMAIL_FROM}>",
                    "to": [email],
                    "subject": "Your Data Platform verification code",
                    "text": (
                        f"Your Data Platform verification code is: {code}\n\n"
                        "Enter this code in the app where you signed in. It expires in 10 minutes.\n"
                        "If you did not request this code, ignore this email. Do not share the code."
                    ),
                },
            )
            if response.status_code not in (200, 201, 202):
                raise ValueError("provider_rejected")
            body = response.json()
            if not isinstance(body, dict) or not isinstance(body.get("id"), str) or not body["id"]:
                raise ValueError("provider_response_invalid")
    except (httpx.HTTPError, ValueError):
        logger.warning("Verification email delivery could not be confirmed", extra={"event": "email_delivery_failed", "reason": "delivery_unconfirmed"})
        # On timeout the provider may have accepted the message; keep that code valid.
        raise HTTPException(503, "Unable to confirm email delivery. Check your inbox; if no code arrives, try again in a minute.") from None


async def request_email_code(db: AsyncSession, user_id: int) -> dict:
    if settings.RESEND_API_KEY is None or not settings.RESEND_API_KEY.get_secret_value().strip() or settings.EMAIL_FROM is None:
        raise HTTPException(503, "Email delivery is not configured")
    user = await _locked_user(db, user_id)
    if user.email_verified:
        return {"status": "already_verified"}
    now = _now()
    if user.email_verification_last_sent_at is not None:
        remaining = RESEND_COOLDOWN_SECONDS - (now - user.email_verification_last_sent_at).total_seconds()
        if remaining > 0:
            raise _rate_limited(math.ceil(remaining))
    start = user.email_verification_window_started_at
    if start is None or now - start >= timedelta(hours=1):
        user.email_verification_window_started_at = now
        user.email_verification_window_count = 0
    if user.email_verification_window_count >= MAX_SENDS_PER_ACCOUNT_HOUR:
        raise _rate_limited(math.ceil(3600 - (now - user.email_verification_window_started_at).total_seconds()))
    await _reserve_delivery_budget(db, now)
    code = f"{secrets.randbelow(100_000_000):08d}"
    nonce = uuid4().hex
    user.email_verification_nonce = nonce
    user.email_verification_digest = _digest(user, nonce, code)
    user.email_verification_expires_at = now + timedelta(seconds=CODE_LIFETIME_SECONDS)
    user.email_verification_last_sent_at = now
    user.email_verification_attempts = 0
    user.email_verification_window_count += 1
    email = user.email
    # Persist budgets/challenge before network I/O. No database lock spans delivery.
    # Failed/uncertain sends conservatively consume the reserved delivery budget.
    await db.commit()
    await _deliver_code(email, code, nonce)
    return {"status": "sent", "retry_after_seconds": RESEND_COOLDOWN_SECONDS, "expires_in_seconds": CODE_LIFETIME_SECONDS}


async def confirm_email_code(db: AsyncSession, user_id: int, code: str) -> User:
    user = await _locked_user(db, user_id)
    if user.email_verified:
        return user
    now = _now()
    if (user.email_verification_digest is None or user.email_verification_nonce is None
        or user.email_verification_expires_at is None or user.email_verification_expires_at <= now
        or user.email_verification_attempts >= MAX_ATTEMPTS):
        raise HTTPException(400, "Invalid or expired verification code. Request a new code.")
    if not hmac.compare_digest(user.email_verification_digest, _digest(user, user.email_verification_nonce, code)):
        user.email_verification_attempts += 1
        if user.email_verification_attempts >= MAX_ATTEMPTS:
            user.email_verification_digest = None
            user.email_verification_nonce = None
            user.email_verification_expires_at = None
        await db.commit()
        raise HTTPException(400, "Invalid or expired verification code. Request a new code.")
    user.email_verified_at = now
    user.email_verification_digest = None
    user.email_verification_nonce = None
    user.email_verification_expires_at = None
    user.email_verification_attempts = 0
    await db.commit()
    await db.refresh(user)
    return user
