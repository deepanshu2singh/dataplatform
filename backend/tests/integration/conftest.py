import asyncio
import os
import shutil
from pathlib import Path
from uuid import uuid4

import asyncpg
import httpx
import pytest


SALES_CSV = (
    b"order_id,product,region,quantity,revenue\n"
    b"1,Laptop,London,2,2400.50\n"
    b"2,Monitor,Manchester,3,899.97\n"
    b"3,Keyboard,Birmingham,5,374.95\n"
    b"4,Mouse,London,8,239.92\n"
    b"5,Laptop,Leeds,1,1199.99\n"
)

AUTH_COOKIE_NAME = "dataplatform_session"
FRONTEND_ORIGIN = os.environ.get(
    "FRONTEND_URL",
    "http://localhost:5173",
).rstrip("/")


async def _truncate_test_database() -> None:
    database_url = os.environ["TEST_DATABASE_URL"]
    connection = await asyncpg.connect(database_url)

    try:
        await connection.execute(
            "TRUNCATE TABLE dashboards, notebooks, datasets, users "
            "RESTART IDENTITY CASCADE"
        )
    finally:
        await connection.close()


def _clear_test_uploads() -> None:
    upload_dir = Path(
        os.environ.get(
            "TEST_UPLOAD_DIR",
            "/tmp/dataplatform-test-uploads",
        )
    )
    upload_dir.mkdir(parents=True, exist_ok=True)

    for child in upload_dir.iterdir():
        if child.is_dir():
            shutil.rmtree(child)
        else:
            child.unlink(missing_ok=True)


@pytest.fixture(scope="session", autouse=True)
def reset_integration_state() -> None:
    asyncio.run(_truncate_test_database())
    _clear_test_uploads()


@pytest.fixture(scope="session")
def api_client() -> httpx.Client:
    base_url = os.environ.get(
        "TEST_API_URL",
        "http://backend-test-api:8000/api/v1/",
    )

    with httpx.Client(base_url=base_url, timeout=30.0) as client:
        yield client


@pytest.fixture(autouse=True)
def clear_api_client_cookies(api_client: httpx.Client):
    api_client.cookies.clear()
    yield
    api_client.cookies.clear()


@pytest.fixture()
def user_factory(api_client: httpx.Client):
    def create(prefix: str = "user") -> dict:
        suffix = uuid4().hex
        email = f"{prefix}-{suffix}@example.com"
        password = "Strong-Test-Pass-123!"
        full_name = f"{prefix.title()} Test User"

        register_response = api_client.post(
            "auth/register",
            headers={"Origin": FRONTEND_ORIGIN},
            json={
                "email": email,
                "password": password,
                "full_name": full_name,
            },
        )
        assert register_response.status_code == 201, register_response.text

        login_response = api_client.post(
            "auth/login",
            headers={"Origin": FRONTEND_ORIGIN},
            data={
                "username": email,
                "password": password,
            },
        )
        assert login_response.status_code == 204, login_response.text

        session_token = login_response.cookies.get(AUTH_COOKIE_NAME)
        assert session_token, login_response.headers.get("set-cookie", "")

        # Keep the shared session-scoped client stateless. Every protected
        # request supplies the intended user's cookie explicitly, which keeps
        # cross-user isolation tests deterministic.
        api_client.cookies.clear()

        return {
            "email": email,
            "password": password,
            "full_name": full_name,
            "user": register_response.json(),
            "session_token": session_token,
            "headers": {
                "Cookie": f"{AUTH_COOKIE_NAME}={session_token}",
                "Origin": FRONTEND_ORIGIN,
            },
        }

    return create


@pytest.fixture()
def sales_dataset_factory(api_client: httpx.Client):
    def create(headers: dict[str, str], name: str | None = None) -> dict:
        dataset_name = name or f"Sales {uuid4().hex[:8]}"
        response = api_client.post(
            "datasets/upload",
            headers=headers,
            data={
                "name": dataset_name,
                "description": "Phase 8A.2 integration test dataset",
            },
            files={
                "file": (
                    "sales.csv",
                    SALES_CSV,
                    "text/csv",
                )
            },
        )
        assert response.status_code == 201, response.text
        return response.json()

    return create
