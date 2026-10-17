from datetime import timedelta
import logging

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_active_user, get_current_enabled_user
from app.core.config import settings
from app.core.security import (
    clear_auth_cookie,
    create_access_token,
    get_password_hash,
    set_auth_cookie,
    verify_password,
)
from app.db.session import get_db
from app.models.user import User as UserModel
from app.schemas.user import User as UserRead, UserCreate, UserProfileUpdate
from app.schemas.email_verification import EmailVerificationCode, EmailVerificationDelivery
from app.schemas.account_security import PasswordChange, SecurityReauthentication
from app.services.account_security import secure_account
from app.services.email_verification import confirm_email_code, request_email_code

router = APIRouter()
logger = logging.getLogger(__name__)


def normalize_email(email: str) -> str:
    return email.strip().lower()


@router.post(
    "/register",
    response_model=UserRead,
    status_code=status.HTTP_201_CREATED,
)
async def register(
    user_in: UserCreate,
    db: AsyncSession = Depends(get_db),
):
    email = normalize_email(str(user_in.email))

    result = await db.execute(
        select(UserModel).where(UserModel.email == email)
    )

    existing_user = result.scalar_one_or_none()

    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists",
        )

    full_name = (
        user_in.full_name.strip()
        if user_in.full_name
        else None
    )

    user = UserModel(
        email=email,
        hashed_password=get_password_hash(user_in.password),
        full_name=full_name or None,
    )

    db.add(user)

    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()

        duplicate_result = await db.execute(
            select(UserModel.id).where(UserModel.email == email)
        )

        if duplicate_result.scalar_one_or_none() is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An account with this email already exists",
            ) from exc

        raise

    await db.refresh(user)

    return user


@router.post("/login", status_code=status.HTTP_204_NO_CONTENT)
async def login(
    response: Response,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db),
):
    email = normalize_email(form_data.username)

    result = await db.execute(
        select(UserModel).where(UserModel.email == email)
    )

    user = result.scalar_one_or_none()

    if not user or not verify_password(
        form_data.password,
        user.hashed_password,
    ):
        logger.warning(
            "Authentication failed",
            extra={
                "event": "authentication_failed",
                "reason": "invalid_credentials",
            },
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )

    if not user.is_active:
        logger.warning(
            "Authentication failed",
            extra={
                "event": "authentication_failed",
                "reason": "inactive_account",
                "user_id": user.id,
            },
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account is inactive",
        )

    session_token = create_access_token(
        data={"sub": user.email, "sv": user.session_version},
        expires_delta=timedelta(
            minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES
        ),
    )

    set_auth_cookie(response, session_token)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(response: Response):
    clear_auth_cookie(response)


@router.get("/me", response_model=UserRead)
async def read_users_me(
    response: Response,
    current_user: UserModel = Depends(get_current_enabled_user),
):
    response.headers["Cache-Control"] = "no-store"
    return current_user


@router.patch("/me", response_model=UserRead)
async def update_users_me(
    payload: UserProfileUpdate,
    response: Response,
    current_user: UserModel = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    response.headers["Cache-Control"] = "no-store"
    # Compare and update atomically: two tabs cannot silently replace each
    # other's names. Accept an already-saved target after a lost response.
    result = await db.execute(
        update(UserModel)
        .where(
            UserModel.id == current_user.id,
            or_(
                UserModel.full_name == payload.expected_full_name,
                UserModel.full_name == payload.full_name,
            ),
        )
        .values(full_name=payload.full_name)
        .returning(UserModel.id)
    )
    if result.scalar_one_or_none() is None:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Your profile changed in another tab. Your edits are kept. Refresh to review the saved profile before trying again.",
        )
    await db.commit()
    await db.refresh(current_user)
    return current_user


@router.post("/email-verification/send", response_model=EmailVerificationDelivery)
async def send_email_verification(
    response: Response,
    current_user: UserModel = Depends(get_current_enabled_user),
    db: AsyncSession = Depends(get_db),
):
    response.headers["Cache-Control"] = "no-store"
    return await request_email_code(db, current_user.id)


@router.post("/email-verification/confirm", response_model=UserRead)
async def confirm_email_verification(
    payload: EmailVerificationCode,
    response: Response,
    current_user: UserModel = Depends(get_current_enabled_user),
    db: AsyncSession = Depends(get_db),
):
    response.headers["Cache-Control"] = "no-store"
    return await confirm_email_code(db, current_user.id, payload.code)


@router.post("/password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(
    payload: PasswordChange,
    response: Response,
    current_user: UserModel = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    await secure_account(db, user_id=current_user.id,
                         expected_version=current_user.session_version,
                         current_password=payload.current_password,
                         new_password=payload.new_password)
    response.headers["Cache-Control"] = "no-store"
    # Revocation is enforced in the database. Do not send a cookie-deletion
    # response that could arrive late and erase a newer concurrent login cookie.


@router.post("/sessions/revoke", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_sessions(
    payload: SecurityReauthentication,
    response: Response,
    current_user: UserModel = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    await secure_account(db, user_id=current_user.id,
                         expected_version=current_user.session_version,
                         current_password=payload.current_password)
    response.headers["Cache-Control"] = "no-store"
    # Revocation is enforced in the database. Do not send a cookie-deletion
    # response that could arrive late and erase a newer concurrent login cookie.
