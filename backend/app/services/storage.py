from __future__ import annotations

import re
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import AsyncIterator
from urllib.parse import parse_qs, quote, urlsplit

import httpx

from app.core.config import settings


TUS_CHUNK_SIZE = 6 * 1024 * 1024

HTTP_TIMEOUT = httpx.Timeout(
    connect=10.0,
    read=120.0,
    write=120.0,
    pool=10.0,
)

_BUCKET_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")
_OBJECT_SEGMENT_PATTERN = re.compile(
    r"^[A-Za-z0-9._-]+$"
)


class StorageServiceError(RuntimeError):
    """Raised when object storage cannot complete an operation."""


class StorageObjectNotFound(StorageServiceError):
    """Raised when a requested storage object does not exist."""


class StorageObjectTooLarge(StorageServiceError):
    """Raised when stored bytes exceed the enforced download limit."""


@dataclass(frozen=True)
class SignedUpload:
    object_key: str
    token: str
    tus_endpoint: str
    chunk_size: int = TUS_CHUNK_SIZE


def build_dataset_object_key(
    owner_id: int,
) -> str:
    if owner_id <= 0:
        raise ValueError(
            "owner_id must be positive"
        )

    return (
        f"users/{owner_id}/"
        f"{uuid.uuid4().hex}.csv"
    )


def _validate_bucket_name(
    value: str,
) -> str:
    candidate = value.strip()

    if (
        not candidate
        or not _BUCKET_PATTERN.fullmatch(
            candidate
        )
    ):
        raise StorageServiceError(
            "Storage bucket configuration is invalid"
        )

    return candidate


def validate_object_key(
    value: str,
) -> str:
    candidate = value.strip()

    if (
        not candidate
        or len(candidate) > 1024
        or candidate.startswith("/")
        or candidate.endswith("/")
        or "\\" in candidate
        or "\x00" in candidate
    ):
        raise StorageServiceError(
            "Storage object key is invalid"
        )

    segments = candidate.split("/")

    if any(
        segment in {"", ".", ".."}
        or not _OBJECT_SEGMENT_PATTERN.fullmatch(
            segment
        )
        for segment in segments
    ):
        raise StorageServiceError(
            "Storage object key is invalid"
        )

    return candidate


class SupabaseStorageService:
    def __init__(
        self,
        *,
        supabase_url: str,
        secret_key: str,
        bucket: str,
        max_download_bytes: int,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self._supabase_url = (
            supabase_url.rstrip("/")
        )
        self._secret_key = (
            secret_key.strip()
        )
        self._bucket = (
            _validate_bucket_name(
                bucket
            )
        )
        self._max_download_bytes = (
            max_download_bytes
        )
        self._client = client

        if not self._supabase_url.startswith(
            "https://"
        ):
            raise StorageServiceError(
                "Supabase Storage URL must use HTTPS"
            )

        if not self._secret_key:
            raise StorageServiceError(
                "Supabase Storage secret is missing"
            )

        if self._max_download_bytes <= 0:
            raise StorageServiceError(
                "Storage download limit is invalid"
            )

    @classmethod
    def from_settings(
        cls,
    ) -> "SupabaseStorageService":
        if (
            settings.STORAGE_BACKEND
            != "supabase"
        ):
            raise StorageServiceError(
                "Supabase Storage is not enabled"
            )

        if (
            settings.SUPABASE_URL is None
            or settings.SUPABASE_SECRET_KEY
            is None
        ):
            raise StorageServiceError(
                "Supabase Storage configuration "
                "is incomplete"
            )

        return cls(
            supabase_url=(
                settings.SUPABASE_URL
            ),
            secret_key=(
                settings
                .SUPABASE_SECRET_KEY
                .get_secret_value()
            ),
            bucket=(
                settings
                .SUPABASE_STORAGE_BUCKET
            ),
            max_download_bytes=(
                settings.effective_upload_max_bytes
            ),
        )

    @property
    def tus_endpoint(
        self,
    ) -> str:
        # Object-scoped x-signature tokens require the signed TUS route.
        parsed = urlsplit(
            self._supabase_url
        )

        hostname = (
            parsed.hostname or ""
        )

        if (
            parsed.scheme == "https"
            and hostname.endswith(
                ".supabase.co"
            )
        ):
            project_ref = hostname[
                : -len(".supabase.co")
            ]

            if (
                project_ref
                and "." not in project_ref
            ):
                return (
                    f"https://{project_ref}"
                    ".storage.supabase.co"
                    "/storage/v1/"
                    "upload/resumable/sign"
                )

        return (
            f"{self._supabase_url}"
            "/storage/v1/"
            "upload/resumable/sign"
        )

    async def create_signed_upload(
        self,
        object_key: str,
    ) -> SignedUpload:
        key = validate_object_key(
            object_key
        )

        url = (
            f"{self._supabase_url}"
            "/storage/v1/object/"
            "upload/sign/"
            f"{quote(self._bucket, safe='')}/"
            f"{self._encode_object_key(key)}"
        )

        async with (
            self._client_context()
            as client
        ):
            try:
                response = (
                    await client.post(
                        url,
                        headers=(
                            self._server_headers()
                        ),
                        json={},
                    )
                )
            except httpx.HTTPError as exc:
                raise StorageServiceError(
                    "Could not contact "
                    "Supabase Storage"
                ) from exc

        self._raise_for_status(
            response
        )

        try:
            payload = response.json()
        except ValueError as exc:
            raise StorageServiceError(
                "Supabase Storage returned "
                "an invalid response"
            ) from exc

        if not isinstance(payload, dict):
            raise StorageServiceError("Supabase Storage returned an invalid response")

        token = payload.get("token")

        if (
            not isinstance(token, str)
            or not token
        ):
            signed_url = (
                payload.get("url")
                or payload.get(
                    "signedURL"
                )
                or payload.get(
                    "signedUrl"
                )
            )

            if isinstance(
                signed_url,
                str,
            ):
                values = parse_qs(
                    urlsplit(
                        signed_url
                    ).query
                ).get("token")

                token = (
                    values[0]
                    if values
                    else None
                )

        if (
            not isinstance(token, str)
            or not token
        ):
            raise StorageServiceError(
                "Supabase Storage did not "
                "return an upload token"
            )

        return SignedUpload(
            object_key=key,
            token=token,
            tus_endpoint=(
                self.tus_endpoint
            ),
        )

    async def download_to_path(
        self,
        object_key: str,
        destination: Path,
    ) -> int:
        key = validate_object_key(
            object_key
        )

        destination = Path(
            destination
        )

        destination.parent.mkdir(
            parents=True,
            exist_ok=True,
        )

        partial_path = (
            destination.with_name(
                f"{destination.name}.part"
            )
        )

        partial_path.unlink(
            missing_ok=True
        )

        url = (
            f"{self._supabase_url}"
            "/storage/v1/object/"
            "authenticated/"
            f"{quote(self._bucket, safe='')}/"
            f"{self._encode_object_key(key)}"
        )

        size = 0

        try:
            async with (
                self._client_context()
                as client
            ):
                try:
                    async with client.stream(
                        "GET",
                        url,
                        headers=(
                            self._server_headers()
                        ),
                    ) as response:
                        if response.status_code >= 400:
                            await response.aread()
                        self._raise_for_status(
                            response,
                            object_not_found=True,
                        )

                        with partial_path.open(
                            "wb"
                        ) as output:
                            async for chunk in (
                                response.aiter_bytes()
                            ):
                                if not chunk:
                                    continue

                                size += len(
                                    chunk
                                )

                                if (
                                    size
                                    > self
                                    ._max_download_bytes
                                ):
                                    raise (
                                        StorageObjectTooLarge(
                                            "Stored dataset "
                                            "exceeds the "
                                            "configured "
                                            "download limit"
                                        )
                                    )

                                output.write(
                                    chunk
                                )

                except (
                    httpx.HTTPError
                ) as exc:
                    raise (
                        StorageServiceError(
                            "Could not contact "
                            "Supabase Storage"
                        )
                    ) from exc

            partial_path.replace(
                destination
            )

            return size

        finally:
            partial_path.unlink(
                missing_ok=True
            )

    async def upload_bytes(
        self, object_key: str, content: bytes, *, overwrite: bool = False,
    ) -> None:
        key = validate_object_key(object_key)
        if not content or len(content) > self._max_download_bytes:
            raise StorageServiceError("Storage upload size is invalid")
        headers = self._server_headers() | {
            "Content-Type": "text/csv; charset=utf-8",
            "Cache-Control": "no-store",
            "x-upsert": "true" if overwrite else "false",
        }
        url = f"{self._supabase_url}/storage/v1/object/{self._bucket}/{self._encode_object_key(key)}"
        async with self._client_context() as client:
            try:
                response = await client.post(url, content=content, headers=headers)
            except httpx.HTTPError as exc:
                raise StorageServiceError("Could not contact Supabase Storage") from exc
        self._raise_for_status(response)

    async def create_signed_download(self, object_key: str, *, expires_seconds: int = 60) -> str:
        key = validate_object_key(object_key)
        if not 1 <= expires_seconds <= 300:
            raise StorageServiceError("Storage download expiry is invalid")
        expected_path = f"/storage/v1/object/sign/{self._bucket}/{self._encode_object_key(key)}"
        url = f"{self._supabase_url}/storage/v1/object/sign/{self._bucket}/{self._encode_object_key(key)}"
        async with self._client_context() as client:
            try:
                response = await client.post(
                    url, headers=self._server_headers(), json={"expiresIn": expires_seconds},
                )
            except httpx.HTTPError as exc:
                raise StorageServiceError("Could not contact Supabase Storage") from exc
        self._raise_for_status(response, object_not_found=True)
        try:
            payload = response.json()
            signed_url = payload.get("signedURL") or payload.get("signedUrl") if isinstance(payload, dict) else None
            if not isinstance(signed_url, str):
                raise ValueError("Missing signed URL")
            parsed = urlsplit(signed_url)
            origin = urlsplit(self._supabase_url)
            if parsed.fragment or parsed.username or parsed.password:
                raise ValueError("Invalid signed URL")
            if parsed.netloc and (parsed.scheme, parsed.netloc) != (origin.scheme, origin.netloc):
                raise ValueError("Unexpected signed URL origin")
            path = parsed.path
            if path.startswith("/object/"):
                path = "/storage/v1" + path
            if path != expected_path or not parse_qs(parsed.query).get("token"):
                raise ValueError("Unexpected signed URL path")
            return f"{self._supabase_url}{path}?{parsed.query}"
        except (ValueError, TypeError) as exc:
            raise StorageServiceError("Supabase Storage returned an invalid signed download") from exc

    async def delete_object(
        self,
        object_key: str,
    ) -> None:
        key = validate_object_key(
            object_key
        )

        url = (
            f"{self._supabase_url}"
            "/storage/v1/object/"
            f"{quote(self._bucket, safe='')}"
        )

        async with (
            self._client_context()
            as client
        ):
            try:
                response = (
                    await client.request(
                        "DELETE",
                        url,
                        headers=(
                            self._server_headers()
                        ),
                        json={
                            "prefixes": [
                                key
                            ]
                        },
                    )
                )
            except httpx.HTTPError as exc:
                raise StorageServiceError(
                    "Could not contact "
                    "Supabase Storage"
                ) from exc

        self._raise_for_status(
            response
        )

    def _server_headers(
        self,
    ) -> dict[str, str]:
        return {
            "apikey": (
                self._secret_key
            ),
            "Accept": (
                "application/json"
            ),
        }

    @staticmethod
    def _encode_object_key(
        object_key: str,
    ) -> str:
        return "/".join(
            quote(
                segment,
                safe="",
            )
            for segment
            in object_key.split("/")
        )

    @staticmethod
    def _raise_for_status(
        response: httpx.Response,
        *,
        object_not_found: bool = False,
    ) -> None:
        if (
            200
            <= response.status_code
            < 300
        ):
            return

        if (
            object_not_found
            and response.status_code
            == 404
        ):
            raise StorageObjectNotFound(
                "Dataset file is missing "
                "from storage"
            )

        if object_not_found and response.status_code == 400:
            try:
                payload = response.json()
            except ValueError:
                payload = None
            if isinstance(payload, dict) and str(payload.get("statusCode")) == "404":
                raise StorageObjectNotFound("Dataset file is missing from storage")

        raise StorageServiceError(
            "Supabase Storage request "
            "failed "
            f"(status "
            f"{response.status_code})"
        )

    @asynccontextmanager
    async def _client_context(
        self,
    ) -> AsyncIterator[
        httpx.AsyncClient
    ]:
        if self._client is not None:
            yield self._client
            return

        async with httpx.AsyncClient(
            timeout=HTTP_TIMEOUT,
            follow_redirects=False,
        ) as client:
            yield client


def get_supabase_storage_service(
) -> SupabaseStorageService:
    return (
        SupabaseStorageService
        .from_settings()
    )
