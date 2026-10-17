"""Anonymous, purpose-bound recovery; no account lookup result leaves this API."""
import asyncio
from datetime import timedelta
import hashlib
import hmac
import logging
import secrets
from time import monotonic
from uuid import uuid4

from fastapi import HTTPException
import httpx
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import SQLAlchemyError
from starlette.concurrency import run_in_threadpool

from app.core.config import settings
from app.core.security import get_password_hash, verify_password
from app.models.email_delivery_limit import EmailDeliveryLimit
from app.models.user import User
from app.services.email_verification import _reserve_delivery_budget

logger = logging.getLogger(__name__)
LIFETIME_SECONDS = 600
COOLDOWN_SECONDS = 60
MAX_SENDS_PER_HOUR = 5
MAX_ATTEMPTS = 5
PUBLIC_REQUESTS_PER_MINUTE = 60
REQUEST_MIN_SECONDS = 6.0
CONFIRM_MIN_SECONDS = 1.0
GENERIC_RESPONSE = {
    "message": "If an active account uses this address, check its inbox for a reset code. Sending limits may delay it.",
    "retry_after_seconds": COOLDOWN_SECONDS,
    "expires_in_seconds": LIFETIME_SECONDS,
}


def _invalid() -> HTTPException:
    return HTTPException(400, "Invalid or expired reset code. Request another code if needed.", headers={"Cache-Control": "no-store"})


def _digest(user: User, nonce: str, code: str) -> str:
    # An authenticated password change or global signout invalidates this proof.
    value = f"password-recovery:{user.id}:{user.email}:{user.session_version}:{nonce}:{code}"
    return hmac.new(settings.SECRET_KEY.encode(), value.encode(), hashlib.sha256).hexdigest()


async def _minimum_duration(start: float, seconds: float) -> None:
    await asyncio.sleep(max(0.0, seconds - (monotonic() - start)))


async def _public_budget(db: AsyncSession, purpose: str) -> None:
    # Exactly two constant rows, not an ever-growing IP/email-address log.
    key = {"request": "recovery-requests-minute", "confirm": "recovery-attempts-minute"}[purpose]
    now = (await db.execute(select(func.clock_timestamp()))).scalar_one()
    window = now.replace(second=0, microsecond=0)
    await db.execute(insert(EmailDeliveryLimit).values(key=key, window_started_at=window, count=0).on_conflict_do_nothing(index_elements=["key"]))
    bucket = await db.scalar(select(EmailDeliveryLimit).where(EmailDeliveryLimit.key == key).with_for_update().execution_options(populate_existing=True))
    if bucket.window_started_at < window:
        bucket.window_started_at = window
        bucket.count = 0
    if bucket.count >= PUBLIC_REQUESTS_PER_MINUTE:
        await db.rollback()
        raise HTTPException(429, "Too many recovery requests. Wait a minute before trying again.", headers={"Retry-After": "60", "Cache-Control": "no-store"})
    bucket.count += 1
    # Release this global lock before taking an account lock. Failure below must
    # not refund the anonymous budget or introduce an opposing lock order.
    await db.commit()


async def _deliver(email: str, nonce: str, code: str | None) -> bool:
    purpose = "code" if code is not None else "confirmation"
    subject = "Your Data Platform password reset code" if code is not None else "Your Data Platform password was reset"
    text = (
        f"Your password reset code is: {code}\n\nEnter it on the Forgot password page with your new password. "
        "It expires in 10 minutes and works once. Only the most recently issued code works.\n"
        "If you did not request a reset, ignore this email. Your password has not changed. Do not share the code."
        if code is not None else
        "Your Data Platform password was reset and existing sign-ins were ended.\n\n"
        "If you did not do this, open Data Platform directly and use Forgot password to secure your account. "
        "Your email verification status and saved work have not changed."
    )
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(3.0, connect=2.0), follow_redirects=False) as client:
            response = await client.post("https://api.resend.com/emails", headers={
                "Authorization": f"Bearer {settings.RESEND_API_KEY.get_secret_value()}",
                "Idempotency-Key": f"password-recovery/{purpose}/{nonce}",
            }, json={"from": f"Data Platform <{settings.EMAIL_FROM}>", "to": [email], "subject": subject, "text": text})
            if response.status_code not in (200, 201, 202):
                raise ValueError("provider_rejected")
            body = response.json()
            if not isinstance(body, dict) or not isinstance(body.get("id"), str) or not body["id"]:
                raise ValueError("provider_response_invalid")
    except (httpx.HTTPError, ValueError):
        logger.warning("Recovery email delivery could not be confirmed", extra={"event": "password_recovery_delivery_failed", "reason": purpose})
        return False
    return True


async def request_recovery(db: AsyncSession, email: str) -> dict:
    if settings.RESEND_API_KEY is None or not settings.RESEND_API_KEY.get_secret_value().strip() or settings.EMAIL_FROM is None:
        raise HTTPException(503, "Password recovery email is temporarily unavailable.", headers={"Cache-Control": "no-store"})
    await _public_budget(db, "request")
    start = monotonic()
    try:
        result = await db.execute(select(User).where(User.email == email).with_for_update().execution_options(populate_existing=True))
        user = result.scalar_one_or_none()
        if user is None or not user.is_active:
            await db.rollback()
            return dict(GENERIC_RESPONSE)
        now = (await db.execute(select(func.clock_timestamp()))).scalar_one()
        if user.password_reset_last_sent_at is not None and now < user.password_reset_last_sent_at + timedelta(seconds=COOLDOWN_SECONDS):
            await db.rollback()
            return dict(GENERIC_RESPONSE)
        if user.password_reset_window_started_at is None or now >= user.password_reset_window_started_at + timedelta(hours=1):
            user.password_reset_window_started_at = now
            user.password_reset_window_count = 0
        if user.password_reset_window_count >= MAX_SENDS_PER_HOUR:
            await db.rollback()
            return dict(GENERIC_RESPONSE)
        try:
            # Charge this delivery in its actual current quota window. A later
            # completion notice reserves separately, including across midnight.
            await _reserve_delivery_budget(db, now)
        except HTTPException:
            await db.rollback()
            return dict(GENERIC_RESPONSE)
        code = f"{secrets.randbelow(100_000_000):08d}"
        nonce = uuid4().hex
        user.password_reset_nonce = nonce
        user.password_reset_digest = _digest(user, nonce, code)
        user.password_reset_expires_at = now + timedelta(seconds=LIFETIME_SECONDS)
        user.password_reset_last_sent_at = now
        user.password_reset_attempts = 0
        user.password_reset_window_count += 1
        address = user.email
        await db.commit()
        # No user/global row lock spans this bounded network call. An uncertain
        # email can still arrive, so a timeout must not delete its valid code.
        await _deliver(address, nonce, code)
        return dict(GENERIC_RESPONSE)
    finally:
        # This reduces the delivery/no-account timing difference. Infrastructure
        # failures can exceed the floor; no perfect constant-latency claim.
        await _minimum_duration(start, REQUEST_MIN_SECONDS)


async def confirm_recovery(db: AsyncSession, email: str, code: str, new_password: str) -> None:
    await _public_budget(db, "confirm")
    start = monotonic()
    try:
        result = await db.execute(select(User).where(User.email == email).with_for_update().execution_options(populate_existing=True))
        user = result.scalar_one_or_none()
        now = (await db.execute(select(func.clock_timestamp()))).scalar_one()
        if (user is None or not user.is_active or user.password_reset_nonce is None
                or user.password_reset_digest is None or user.password_reset_expires_at is None
                or user.password_reset_expires_at <= now or user.password_reset_attempts >= MAX_ATTEMPTS):
            await db.rollback()
            raise _invalid()
        user.password_reset_attempts += 1
        if not hmac.compare_digest(user.password_reset_digest, _digest(user, user.password_reset_nonce, code)):
            if user.password_reset_attempts >= MAX_ATTEMPTS:
                user.password_reset_digest = None
                user.password_reset_nonce = None
                user.password_reset_expires_at = None
            await db.commit()
            raise _invalid()
        if await run_in_threadpool(verify_password, new_password, user.hashed_password):
            # A proved challenge remains usable only while attempts remain.
            await db.commit()
            raise HTTPException(400, "Choose a password different from your current password.", headers={"Cache-Control": "no-store"})
        address, nonce = user.email, user.password_reset_nonce
        user.hashed_password = await run_in_threadpool(get_password_hash, new_password)
        user.session_version += 1
        user.password_reset_digest = None
        user.password_reset_nonce = None
        user.password_reset_expires_at = None
        user.password_reset_attempts = 0
        await db.commit()
        await _completion_notice(db, address, nonce)
    finally:
        await _minimum_duration(start, CONFIRM_MIN_SECONDS)


async def _completion_notice(db: AsyncSession, address: str, nonce: str) -> None:
    # Reserve against the CURRENT day/minute, not the earlier request window.
    # The password commit is already authoritative; notification/quota failure
    # cannot undo it or return a false reset failure. No background task is lost
    # after a serverless response and no plaintext proof is stored in an outbox.
    if settings.RESEND_API_KEY is None or settings.EMAIL_FROM is None:
        return
    try:
        now = (await db.execute(select(func.clock_timestamp()))).scalar_one()
        await _reserve_delivery_budget(db, now)
        await db.commit()
    except (HTTPException, SQLAlchemyError):
        try:
            await db.rollback()
        except SQLAlchemyError:
            pass
        logger.warning("Recovery completion notice could not be reserved", extra={"event": "password_recovery_delivery_failed", "reason": "notification_budget_or_database"})
        return
    await _deliver(address, nonce, None)
