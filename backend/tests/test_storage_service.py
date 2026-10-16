import asyncio
import json
from pathlib import Path

import httpx
import pytest

from app.services.storage import (
    StorageServiceError,
    SupabaseStorageService,
    TUS_CHUNK_SIZE,
    build_dataset_object_key,
    validate_object_key,
)


def _service(
    handler,
    *,
    max_download_bytes: int = (
        50 * 1024 * 1024
    ),
):
    transport = httpx.MockTransport(
        handler
    )

    client = httpx.AsyncClient(
        transport=transport
    )

    service = SupabaseStorageService(
        supabase_url=(
            "https://example.supabase.co"
        ),
        secret_key=(
            "sb_secret_test-value"
        ),
        bucket="datasets",
        max_download_bytes=(
            max_download_bytes
        ),
        client=client,
    )

    return service, client


def test_build_dataset_object_key_is_user_scoped_and_unique(
) -> None:
    first = (
        build_dataset_object_key(7)
    )
    second = (
        build_dataset_object_key(7)
    )

    assert first.startswith(
        "users/7/"
    )
    assert first.endswith(".csv")

    assert second.startswith(
        "users/7/"
    )

    assert first != second


@pytest.mark.parametrize(
    "value",
    [
        "",
        "/users/7/file.csv",
        "users/../file.csv",
        "users\\7\\file.csv",
        "users//file.csv",
        "users/./file.csv",
    ],
)
def test_validate_object_key_rejects_unsafe_paths(
    value: str,
) -> None:
    with pytest.raises(
        StorageServiceError,
        match="object key is invalid",
    ):
        validate_object_key(
            value
        )


def test_create_signed_upload_uses_secret_as_apikey_only(
) -> None:
    def handler(
        request: httpx.Request,
    ) -> httpx.Response:
        assert request.method == "POST"

        assert request.url.path == (
            "/storage/v1/object/"
            "upload/sign/"
            "datasets/"
            "users/7/file.csv"
        )

        assert (
            request.headers["apikey"]
            == "sb_secret_test-value"
        )

        assert (
            "authorization"
            not in request.headers
        )

        return httpx.Response(
            200,
            json={
                "url": (
                    "/object/upload/sign/"
                    "datasets/"
                    "users/7/file.csv"
                    "?token=signed-token"
                )
            },
        )

    service, client = _service(
        handler
    )

    try:
        result = asyncio.run(
            service.create_signed_upload(
                "users/7/file.csv"
            )
        )
    finally:
        asyncio.run(
            client.aclose()
        )

    assert (
        result.object_key
        == "users/7/file.csv"
    )

    assert (
        result.token
        == "signed-token"
    )

    assert (
        result.chunk_size
        == TUS_CHUNK_SIZE
    )

    assert result.tus_endpoint == (
        "https://example"
        ".storage.supabase.co"
        "/storage/v1/"
        "upload/resumable/sign"
    )


def test_create_signed_upload_rejects_missing_token(
) -> None:
    def handler(
        request: httpx.Request,
    ) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "url": (
                    "/missing-token"
                )
            },
        )

    service, client = _service(
        handler
    )

    try:
        with pytest.raises(
            StorageServiceError,
            match=(
                "did not return "
                "an upload token"
            ),
        ):
            asyncio.run(
                service
                .create_signed_upload(
                    "users/7/file.csv"
                )
            )
    finally:
        asyncio.run(
            client.aclose()
        )


def test_storage_error_does_not_expose_secret_or_body(
) -> None:
    def handler(
        request: httpx.Request,
    ) -> httpx.Response:
        return httpx.Response(
            500,
            text=(
                "server detail "
                "sb_secret_test-value "
                "should never escape"
            ),
        )

    service, client = _service(
        handler
    )

    try:
        with pytest.raises(
            StorageServiceError
        ) as exc_info:
            asyncio.run(
                service
                .create_signed_upload(
                    "users/7/file.csv"
                )
            )
    finally:
        asyncio.run(
            client.aclose()
        )

    message = str(
        exc_info.value
    )

    assert (
        "sb_secret_test-value"
        not in message
    )

    assert (
        "should never escape"
        not in message
    )

    assert (
        "status 500"
        in message
    )


def test_download_to_path_streams_private_object(
    tmp_path: Path,
) -> None:
    content = b"a,b\n1,2\n"

    def handler(
        request: httpx.Request,
    ) -> httpx.Response:
        assert request.method == "GET"

        assert request.url.path == (
            "/storage/v1/object/"
            "authenticated/"
            "datasets/"
            "users/7/file.csv"
        )

        assert (
            request.headers["apikey"]
            == "sb_secret_test-value"
        )

        assert (
            "authorization"
            not in request.headers
        )

        return httpx.Response(
            200,
            content=content,
        )

    service, client = _service(
        handler
    )

    destination = (
        tmp_path / "dataset.csv"
    )

    try:
        size = asyncio.run(
            service.download_to_path(
                "users/7/file.csv",
                destination,
            )
        )
    finally:
        asyncio.run(
            client.aclose()
        )

    assert size == len(content)

    assert (
        destination.read_bytes()
        == content
    )

    assert not (
        tmp_path
        / "dataset.csv.part"
    ).exists()


def test_download_limit_removes_partial_file(
    tmp_path: Path,
) -> None:
    def handler(
        request: httpx.Request,
    ) -> httpx.Response:
        return httpx.Response(
            200,
            content=b"123456",
        )

    service, client = _service(
        handler,
        max_download_bytes=5,
    )

    destination = (
        tmp_path / "dataset.csv"
    )

    try:
        with pytest.raises(
            StorageServiceError,
            match=(
                "exceeds the configured "
                "download limit"
            ),
        ):
            asyncio.run(
                service.download_to_path(
                    "users/7/file.csv",
                    destination,
                )
            )
    finally:
        asyncio.run(
            client.aclose()
        )

    assert not destination.exists()

    assert not (
        tmp_path
        / "dataset.csv.part"
    ).exists()


def test_delete_object_uses_expected_storage_api(
) -> None:
    def handler(
        request: httpx.Request,
    ) -> httpx.Response:
        assert request.method == "DELETE"

        assert request.url.path == (
            "/storage/v1/object/"
            "datasets"
        )

        assert (
            request.headers["apikey"]
            == "sb_secret_test-value"
        )

        assert (
            "authorization"
            not in request.headers
        )

        body = json.loads(
            request.content
        )

        assert body == {
            "prefixes": [
                "users/7/file.csv"
            ]
        }

        return httpx.Response(
            200,
            json=[],
        )

    service, client = _service(
        handler
    )

    try:
        asyncio.run(
            service.delete_object(
                "users/7/file.csv"
            )
        )
    finally:
        asyncio.run(
            client.aclose()
        )

@pytest.mark.parametrize(
    "supabase_url, expected_endpoint",
    [
        ("https://ckjkgsojwtzbiyqxbtdx.supabase.co/",
         "https://ckjkgsojwtzbiyqxbtdx.storage.supabase.co/storage/v1/upload/resumable/sign"),
        ("https://storage.example.test/",
         "https://storage.example.test/storage/v1/upload/resumable/sign"),
    ],
)
def test_signed_tus_contract_preserves_host_selection(supabase_url, expected_endpoint):
    adapter = SupabaseStorageService(
        supabase_url=supabase_url, secret_key="sb_secret_test-value",
        bucket="datasets", max_download_bytes=100,
    )
    assert adapter.tus_endpoint == expected_endpoint
