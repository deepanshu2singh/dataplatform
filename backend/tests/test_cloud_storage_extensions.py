import asyncio
import json
import httpx
import pytest
from app.services.storage import SupabaseStorageService, StorageServiceError, StorageObjectNotFound


def service(handler):
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return SupabaseStorageService(supabase_url="https://example.supabase.co", secret_key="sb_secret_sensitive", bucket="datasets", max_download_bytes=100, client=client), client


def test_signed_download_normalizes_and_uses_short_expiry():
    def handler(request):
        assert json.loads(request.content) == {"expiresIn":60}
        assert request.headers["apikey"] == "sb_secret_sensitive"
        assert "authorization" not in request.headers
        return httpx.Response(200, json={"signedURL":"/object/sign/datasets/users/7/test.python.csv?token=short-lived"})
    adapter, client = service(handler)
    async def run():
        async with client:
            assert await adapter.create_signed_download("users/7/test.python.csv") == "https://example.supabase.co/storage/v1/object/sign/datasets/users/7/test.python.csv?token=short-lived"
    asyncio.run(run())


@pytest.mark.parametrize("url", ["https://evil.example/object/sign/datasets/users/7/test.csv?token=secret", "/object/sign/datasets/users/8/test.csv?token=secret", "/object/sign/datasets/users/7/test.csv", "https://user:password@example.supabase.co/object/sign/datasets/users/7/test.csv?token=secret"])
def test_signed_download_rejects_wrong_origin_path_or_capability(url):
    adapter, client = service(lambda request: httpx.Response(200,json={"signedURL":url}))
    async def run():
        async with client:
            with pytest.raises(StorageServiceError) as error:
                await adapter.create_signed_download("users/7/test.csv")
            assert "secret" not in str(error.value) and "password" not in str(error.value)
    asyncio.run(run())


def test_400_missing_object_classifies_as_missing(tmp_path):
    adapter, client = service(lambda request: httpx.Response(400,json={"statusCode":"404", "message":"sensitive/path"}))
    async def run():
        async with client:
            with pytest.raises(StorageObjectNotFound): await adapter.download_to_path("users/7/test.csv",tmp_path/"download.csv")
    asyncio.run(run())
    assert not list(tmp_path.iterdir())


def test_snapshot_upload_does_not_expose_server_secret_to_body():
    def handler(request):
        assert request.content == b"a\n1\n"
        assert request.headers["x-upsert"] == "true"
        assert request.headers["apikey"] == "sb_secret_sensitive"
        return httpx.Response(200,json={"Key":"datasets/users/7/test.python.csv"})
    adapter, client = service(handler)
    async def run():
        async with client: await adapter.upload_bytes("users/7/test.python.csv",b"a\n1\n",overwrite=True)
    asyncio.run(run())


def test_malformed_sign_payload_is_safe():
    adapter, client = service(lambda request: httpx.Response(200,json=[]))
    async def run():
        async with client:
            with pytest.raises(StorageServiceError): await adapter.create_signed_upload("users/7/test.csv")
    asyncio.run(run())


def test_cancelled_download_removes_partial_file(tmp_path):
    async def run():
        started = asyncio.Event()
        class Stream(httpx.AsyncByteStream):
            async def __aiter__(self):
                yield b"first chunk"
                started.set()
                await asyncio.Event().wait()
        adapter, client = service(lambda request: httpx.Response(200,stream=Stream()))
        async with client:
            task = asyncio.create_task(adapter.download_to_path("users/7/test.csv", tmp_path/"download.csv"))
            await asyncio.wait_for(started.wait(),2)
            task.cancel()
            with pytest.raises(asyncio.CancelledError): await task
        assert not list(tmp_path.iterdir())
    asyncio.run(run())
