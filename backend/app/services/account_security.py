"""Account-wide cookie revocation, serialized across serverless instances."""
from datetime import timedelta
import math

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.core.config import settings
from app.core.security import get_password_hash, verify_password
from app.models.user import User

WINDOW = timedelta(minutes=15)
MAX_ATTEMPTS = 5


def _error(status: int, detail: str, headers: dict[str, str] | None = None) -> HTTPException:
    return HTTPException(status, detail, headers={"Cache-Control": "no-store", **(headers or {})})


async def secure_account(
    db: AsyncSession,
    *,
    user_id: int,
    expected_version: int,
    current_password: str,
    new_password: str | None = None,
) -> None:
    # Refresh even if the authentication dependency already loaded this ORM row.
    # The row lock covers both password verification and the version increment.
    result = await db.execute(
        select(User).where(User.id == user_id).with_for_update()
        .execution_options(populate_existing=True)
    )
    user = result.scalar_one_or_none()
    if user is None or user.session_version != expected_version:
        await db.rollback()
        raise _error(401, "Your session has ended. Sign in again.")
    if not user.is_active:
        await db.rollback()
        raise _error(403, "Inactive user")
    if settings.EMAIL_VERIFICATION_REQUIRED and not user.email_verified:
        await db.rollback()
        raise _error(403, "Verify your email before using the workspace", headers={"X-Email-Verification-Required": "true"})

    # Shared database time and durable per-account counters, not process memory.
    now = (await db.execute(select(func.clock_timestamp()))).scalar_one()
    if user.security_window_started_at is None or now >= user.security_window_started_at + WINDOW:
        user.security_window_started_at = now
        user.security_attempts = 0
    if user.security_attempts >= MAX_ATTEMPTS:
        wait = max(1, math.ceil((user.security_window_started_at + WINDOW - now).total_seconds()))
        await db.rollback()
        raise _error(429, "Too many security attempts. Wait before trying again.", headers={"Retry-After": str(wait)})

    # Count every submitted reauthentication, including valid-password/no-op
    # attempts, so this endpoint cannot become an unbounded password-hash oracle.
    user.security_attempts += 1
    matches = await run_in_threadpool(verify_password, current_password, user.hashed_password)
    if not matches:
        await db.commit()  # A failed password must consume its durable attempt.
        raise _error(400, "The current password is incorrect.")
    if new_password is not None:
        if await run_in_threadpool(verify_password, new_password, user.hashed_password):
            await db.commit()
            raise _error(400, "Choose a password different from your current password.")
        user.hashed_password = await run_in_threadpool(get_password_hash, new_password)

    user.session_version += 1
    # Deliberately retain this window's counter across success and new logins.
    # The version invalidates every older cookie, including the requesting one.
    await db.commit()
