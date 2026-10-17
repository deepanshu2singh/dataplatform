"""Owner-scoped, bounded workspace copies. No saved code or queries are executed."""
import base64
from datetime import datetime, timedelta, timezone
import hashlib
import json
import math
import re
from uuid import uuid4

from fastapi import HTTPException
from jose import JWTError, jwt
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.core.config import settings
from app.core.security import verify_password
from app.models.dashboard import Dashboard
from app.models.dataset import Dataset, DatasetType
from app.models.dataset_upload import DatasetUpload
from app.models.notebook import Notebook
from app.models.user import User
from app.services.dataset_files import DatasetFileError, cloud_object_key
from app.services.storage import StorageObjectNotFound, StorageServiceError, SupabaseStorageService

PROOF_SECONDS = 900
CATALOG_PAGE_SIZE = 25
FRAGMENT_BYTES = 384 * 1024
MAX_RECORD_BYTES = 32 * 1024 * 1024
AUDIENCE = "dataplatform-workspace-export-v1"
MODELS = {"datasets": Dataset, "notebooks": Notebook, "dashboards": Dashboard, "uploads": DatasetUpload}


def error(code: int, detail: str, headers: dict | None = None) -> HTTPException:
    return HTTPException(code, detail, headers={"Cache-Control": "no-store", **(headers or {})})


def timestamp(value):
    return value.isoformat() if value is not None else None


def profile(user: User) -> dict:
    return {"id": user.id, "email": user.email, "full_name": user.full_name,
            "created_at": timestamp(user.created_at), "updated_at": timestamp(user.updated_at),
            "email_verified": user.email_verified, "email_verified_at": timestamp(user.email_verified_at)}


def make_proof(user: User, now: datetime) -> str:
    issued = int(now.timestamp())
    return jwt.encode({"sub": str(user.id), "sv": user.session_version, "purpose": "workspace_export",
                       "aud": AUDIENCE, "iat": issued, "exp": issued + PROOF_SECONDS, "jti": uuid4().hex},
                      settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def check_proof(token: str, user: User) -> None:
    try:
        claims = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM], audience=AUDIENCE,
                            options={"require_exp": True, "require_iat": True, "require_sub": True})
        if (claims.get("purpose") != "workspace_export" or claims.get("sub") != str(user.id)
                or type(claims.get("sv")) is not int or claims["sv"] != user.session_version
                or type(claims.get("iat")) is not int or type(claims.get("exp")) is not int
                or claims["exp"] - claims["iat"] != PROOF_SECONDS
                or claims["iat"] > int(datetime.now(timezone.utc).timestamp()) + 30
                or not re.fullmatch(r"[0-9a-f]{32}", str(claims.get("jti", "")))):
            raise ValueError("Invalid export authorization")
    except (JWTError, ValueError, TypeError, KeyError):
        raise error(403, "Export confirmation expired or is invalid. Confirm your password again.",
                    {"X-Export-Confirmation-Required": "true"}) from None


async def authorize(db: AsyncSession, user_id: int, expected_version: int, password: str) -> dict:
    result = await db.execute(select(User).where(User.id == user_id).with_for_update()
                              .execution_options(populate_existing=True))
    user = result.scalar_one_or_none()
    if user is None or user.session_version != expected_version:
        await db.rollback()
        raise error(401, "Your session has ended. Sign in again.")
    if not user.is_active or (settings.EMAIL_VERIFICATION_REQUIRED and not user.email_verified):
        await db.rollback()
        raise error(403, "An active verified account is required.")
    now = (await db.execute(select(func.clock_timestamp()))).scalar_one()
    if user.security_window_started_at is None or now >= user.security_window_started_at + timedelta(minutes=15):
        user.security_window_started_at, user.security_attempts = now, 0
    if user.security_attempts >= 5:
        wait = max(1, math.ceil((user.security_window_started_at + timedelta(minutes=15) - now).total_seconds()))
        await db.rollback()
        raise error(429, "Too many security confirmations. Wait before trying again.", {"Retry-After": str(wait)})
    user.security_attempts += 1
    matches = await run_in_threadpool(verify_password, password, user.hashed_password)
    if not matches:
        await db.commit()
        raise error(400, "The current password is incorrect.")
    # This confirmation deliberately does NOT call secure_account or change sv.
    result = {"proof": make_proof(user, now), "expires_in_seconds": PROOF_SECONDS, "account": profile(user),
              "max_file_bytes": settings.effective_upload_max_bytes}
    await db.commit()
    return result


def record_key(category: str, value: str):
    if category == "uploads":
        if re.fullmatch(r"[0-9a-f]{32}", value):
            return value
    elif re.fullmatch(r"[1-9][0-9]{0,9}", value) and int(value) <= 2147483647:
        return int(value)
    raise error(422, "Invalid export record identifier.")


def revision(category, row) -> str:
    return f"{row.status}:{row.dataset_id or 0}" if category == "uploads" else str(row.version)


async def catalog(db: AsyncSession, user: User, category: str, after: str | None) -> dict:
    model = MODELS[category]
    # Select only catalog fields, never load many large notebook/layout JSON values.
    fields = [model.id, model.name]
    fields += [model.status, model.dataset_id] if category == "uploads" else [model.version]
    if category == "datasets":
        fields += [model.type]
    query = select(*fields).where(model.owner_id == user.id).order_by(model.id).limit(CATALOG_PAGE_SIZE + 1)
    if after is not None:
        query = query.where(model.id > record_key(category, after))
    rows = (await db.execute(query)).all()
    page = rows[:CATALOG_PAGE_SIZE]
    return {"items": [{"id": str(row.id), "name": row.name, "revision": revision(category, row),
                       "source_file": category == "datasets" and row.type == DatasetType.FILE} for row in page],
            "next_cursor": str(page[-1].id) if len(rows) > CATALOG_PAGE_SIZE else None}


async def owned(db, user: User, category: str, key: str):
    model = MODELS[category]
    row = (await db.execute(select(model).where(model.id == record_key(category, key), model.owner_id == user.id)
                            .execution_options(populate_existing=True))).scalar_one_or_none()
    if row is None:
        raise error(404, "This workspace item is unavailable. It may have changed; restart the export.")
    return row


def serialize(category: str, row) -> dict:
    data = {"id": row.id, "name": row.name, "description": row.description, "created_at": timestamp(row.created_at)}
    if category == "uploads":
        data.update(original_filename=row.original_filename, size_bytes=row.expected_size, status=row.status,
                    expires_at=timestamp(row.expires_at), dataset_id=row.dataset_id)
    else:
        data.update(version=row.version, updated_at=timestamp(row.updated_at))
        if category == "datasets":
            data.update(type=row.type.value, schema_info=row.schema_info,
                        source_file_download="separate" if row.type == DatasetType.FILE else "external_source_not_copied")
            # config is intentionally never exported: it can contain server paths or connection secrets.
        elif category == "notebooks":
            data["content"] = row.content
        else:
            data["layout"] = row.layout
    return data


async def record_fragment(db, user: User, category: str, key: str, expected_revision: str, offset: int) -> dict:
    row = await owned(db, user, category, key)
    if revision(category, row) != expected_revision:
        raise error(409, "This workspace item changed during export. Restart the export to use its saved version.")
    try:
        data = json.dumps(serialize(category, row), ensure_ascii=False, sort_keys=True,
                          separators=(",", ":"), allow_nan=False).encode("utf-8")
    except (ValueError, UnicodeError, TypeError):
        raise error(409, "This workspace item could not be exported. Contact the operator for help.") from None
    if len(data) > MAX_RECORD_BYTES:
        raise error(413, "This saved item is too large for this export tool. Contact the operator for an alternative copy.")
    if offset >= len(data) or offset % FRAGMENT_BYTES:
        raise error(422, "Invalid export fragment offset.")
    end = min(offset + FRAGMENT_BYTES, len(data))
    return {"data_base64": base64.b64encode(data[offset:end]).decode("ascii"), "total_bytes": len(data),
            "next_offset": end if end < len(data) else None, "sha256": hashlib.sha256(data).hexdigest()}


async def dataset_file_download(db, user: User, dataset_id: int) -> dict:
    row = await owned(db, user, "datasets", str(dataset_id))
    if row.type != DatasetType.FILE or (row.config or {}).get("storage_backend") != "supabase":
        raise error(409, "A private cloud source file is not available for this dataset. Contact the operator for help.")
    try:
        key = cloud_object_key(row.config, user.id)
        storage = SupabaseStorageService.from_settings()
        url = await storage.create_signed_download(key, expires_seconds=60)
    except (DatasetFileError, StorageObjectNotFound):
        raise error(404, "The original dataset file is unavailable. Contact the operator for help.") from None
    except StorageServiceError:
        raise error(503, "The original file could not be prepared. Please try again.") from None
    return {"url": url, "expires_in_seconds": 60, "filename": f"dataset-{row.id}.csv",
            "max_bytes": settings.effective_upload_max_bytes}
