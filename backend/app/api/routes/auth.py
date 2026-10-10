from datetime import timedelta
import logging

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_active_user
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
from app.schemas.user import User as UserRead, UserCreate

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
        data={"sub": user.email},
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
    current_user: UserModel = Depends(get_current_active_user),
):
    return current_user
