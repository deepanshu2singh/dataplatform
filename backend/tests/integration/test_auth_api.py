import os
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import httpx

AUTH_COOKIE_NAME = "dataplatform_session"
FRONTEND_ORIGIN = os.environ.get(
    "FRONTEND_URL",
    "http://localhost:5173",
).rstrip("/")
ORIGIN_HEADERS = {"Origin": FRONTEND_ORIGIN}


def test_register_normalizes_email_and_rejects_duplicate(
    api_client: httpx.Client,
) -> None:
    suffix = uuid4().hex
    mixed_case_email = f"Person-{suffix}@Example.COM"
    normalized_email = f"person-{suffix}@example.com"
    password = "Strong-Test-Pass-123!"

    first = api_client.post(
        "auth/register",
        headers=ORIGIN_HEADERS,
        json={
            "email": mixed_case_email,
            "password": password,
            "full_name": "  Example Person  ",
        },
    )
    assert first.status_code == 201, first.text
    assert first.json()["email"] == normalized_email
    assert first.json()["full_name"] == "Example Person"

    duplicate = api_client.post(
        "auth/register",
        headers=ORIGIN_HEADERS,
        json={
            "email": normalized_email,
            "password": password,
        },
    )
    assert duplicate.status_code == 409


def test_concurrent_duplicate_registration_returns_one_created_one_conflict(
    api_client: httpx.Client,
) -> None:
    suffix = uuid4().hex
    email = f"concurrent-{suffix}@example.com"
    password = "Strong-Test-Pass-123!"
    barrier = Barrier(2)

    def register_once() -> int:
        with httpx.Client(
            base_url=api_client.base_url,
            timeout=30.0,
        ) as client:
            barrier.wait(timeout=10)
            response = client.post(
                "auth/register",
                headers=ORIGIN_HEADERS,
                json={
                    "email": email,
                    "password": password,
                    "full_name": "Concurrent Registration",
                },
            )
            return response.status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(register_once) for _ in range(2)]
        statuses = sorted(future.result() for future in futures)

    assert statuses == [201, 409]


def test_login_rejects_wrong_password(
    api_client: httpx.Client,
    user_factory,
) -> None:
    user = user_factory("wrong-password")

    response = api_client.post(
        "auth/login",
        headers=ORIGIN_HEADERS,
        data={
            "username": user["email"],
            "password": "Definitely-Wrong-Password",
        },
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Incorrect email or password"


def test_login_sets_http_only_cookie_without_returning_token(
    api_client: httpx.Client,
) -> None:
    suffix = uuid4().hex
    email = f"cookie-login-{suffix}@example.com"
    password = "Strong-Test-Pass-123!"

    registered = api_client.post(
        "auth/register",
        headers=ORIGIN_HEADERS,
        json={
            "email": email,
            "password": password,
            "full_name": "Cookie Login Test",
        },
    )
    assert registered.status_code == 201, registered.text

    response = api_client.post(
        "auth/login",
        headers=ORIGIN_HEADERS,
        data={"username": email, "password": password},
    )

    assert response.status_code == 204, response.text
    assert response.content == b""

    set_cookie = response.headers.get("set-cookie", "").lower()
    assert f"{AUTH_COOKIE_NAME}=" in set_cookie
    assert "httponly" in set_cookie
    assert "samesite=lax" in set_cookie
    assert "path=/api/v1" in set_cookie
    assert "access_token" not in response.text


def test_session_cookie_can_read_me(
    api_client: httpx.Client,
    user_factory,
) -> None:
    user = user_factory("me")

    response = api_client.get(
        "auth/me",
        headers=user["headers"],
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["email"] == user["email"]
    assert payload["full_name"] == user["full_name"]
    assert payload["id"] == user["user"]["id"]


def test_bearer_token_no_longer_authenticates(
    api_client: httpx.Client,
    user_factory,
) -> None:
    user = user_factory("bearer-disabled")

    response = api_client.get(
        "auth/me",
        headers={
            "Authorization": f"Bearer {user['session_token']}"
        },
    )

    assert response.status_code == 401


def test_unsafe_cookie_request_requires_frontend_origin(
    api_client: httpx.Client,
    user_factory,
) -> None:
    user = user_factory("origin")

    response = api_client.delete(
        "datasets/999999",
        headers={
            "Cookie": f"{AUTH_COOKIE_NAME}={user['session_token']}"
        },
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Invalid request origin"


def test_logout_clears_session_cookie(
    api_client: httpx.Client,
    user_factory,
) -> None:
    user = user_factory("logout")

    response = api_client.post(
        "auth/logout",
        headers=user["headers"],
    )

    assert response.status_code == 204
    set_cookie = response.headers.get("set-cookie", "").lower()
    assert f"{AUTH_COOKIE_NAME}=" in set_cookie
    assert "max-age=0" in set_cookie


def test_protected_endpoint_requires_authentication(
    api_client: httpx.Client,
) -> None:
    response = api_client.get("datasets")
    assert response.status_code == 401
