import os
from urllib.parse import urlsplit
from uuid import uuid4

import httpx


AUTH_COOKIE_NAME = "dataplatform_session"
FRONTEND_ORIGIN = os.environ.get(
    "FRONTEND_URL",
    "http://localhost:5173",
).rstrip("/")
FOREIGN_ORIGIN = "https://attacker.example"

CSV_BYTES = (
    b"order_id,product,revenue\n"
    b"1,Laptop,2400.50\n"
)


def _cookie_header(user: dict) -> dict[str, str]:
    return {
        "Cookie": (
            f"{AUTH_COOKIE_NAME}={user['session_token']}"
        )
    }


def _api_origin(api_client: httpx.Client) -> str:
    parsed = urlsplit(str(api_client.base_url))
    return f"{parsed.scheme}://{parsed.netloc}"


def test_register_and_login_require_a_trusted_origin(
    api_client: httpx.Client,
    user_factory,
) -> None:
    suffix = uuid4().hex
    registration_body = {
        "email": f"csrf-register-{suffix}@example.com",
        "password": "Strong-Test-Pass-123!",
    }

    missing_register = api_client.post(
        "auth/register",
        json=registration_body,
    )
    assert missing_register.status_code == 403
    assert missing_register.json()["detail"] == "Invalid request origin"

    foreign_register = api_client.post(
        "auth/register",
        headers={"Origin": FOREIGN_ORIGIN},
        json=registration_body,
    )
    assert foreign_register.status_code == 403

    user = user_factory("csrf-login")
    login_data = {
        "username": user["email"],
        "password": user["password"],
    }

    missing_login = api_client.post(
        "auth/login",
        data=login_data,
    )
    assert missing_login.status_code == 403

    foreign_login = api_client.post(
        "auth/login",
        headers={"Origin": FOREIGN_ORIGIN},
        data=login_data,
    )
    assert foreign_login.status_code == 403

    frontend_login = api_client.post(
        "auth/login",
        headers={"Origin": FRONTEND_ORIGIN},
        data=login_data,
    )
    assert frontend_login.status_code == 204

    # Same-origin API clients such as Swagger remain usable.
    api_client.cookies.clear()
    same_origin_login = api_client.post(
        "auth/login",
        headers={"Origin": _api_origin(api_client)},
        data=login_data,
    )
    assert same_origin_login.status_code == 204


def test_logout_requires_a_trusted_origin(
    api_client: httpx.Client,
    user_factory,
) -> None:
    user = user_factory("csrf-logout")
    cookie_header = _cookie_header(user)

    missing = api_client.post(
        "auth/logout",
        headers=cookie_header,
    )
    assert missing.status_code == 403

    foreign = api_client.post(
        "auth/logout",
        headers={
            **cookie_header,
            "Origin": FOREIGN_ORIGIN,
        },
    )
    assert foreign.status_code == 403

    allowed = api_client.post(
        "auth/logout",
        headers=user["headers"],
    )
    assert allowed.status_code == 204


def test_protected_mutation_rejects_missing_and_foreign_origin(
    api_client: httpx.Client,
    user_factory,
) -> None:
    user = user_factory("csrf-mutation")
    cookie_header = _cookie_header(user)

    missing = api_client.delete(
        "datasets/999999",
        headers=cookie_header,
    )
    assert missing.status_code == 403

    foreign = api_client.delete(
        "datasets/999999",
        headers={
            **cookie_header,
            "Origin": FOREIGN_ORIGIN,
        },
    )
    assert foreign.status_code == 403

    allowed = api_client.delete(
        "datasets/999999",
        headers=user["headers"],
    )
    assert allowed.status_code == 404


def test_safe_get_requests_are_not_blocked_by_csrf_middleware(
    api_client: httpx.Client,
    user_factory,
) -> None:
    user = user_factory("csrf-safe-get")
    cookie_header = _cookie_header(user)

    missing_origin = api_client.get(
        "auth/me",
        headers=cookie_header,
    )
    assert missing_origin.status_code == 200

    foreign_origin = api_client.get(
        "auth/me",
        headers={
            **cookie_header,
            "Origin": FOREIGN_ORIGIN,
        },
    )
    assert foreign_origin.status_code == 200


def test_allowed_cors_preflight_is_not_blocked(
    api_client: httpx.Client,
) -> None:
    response = api_client.options(
        "datasets/999999",
        headers={
            "Origin": FRONTEND_ORIGIN,
            "Access-Control-Request-Method": "DELETE",
            "Access-Control-Request-Headers": "content-type",
        },
    )

    assert response.status_code == 200, response.text
    assert (
        response.headers.get("access-control-allow-origin")
        == FRONTEND_ORIGIN
    )


def test_multipart_upload_is_streamed_for_allowed_origin_and_blocked_for_foreign_origin(
    api_client: httpx.Client,
    user_factory,
) -> None:
    user = user_factory("csrf-upload")

    allowed = api_client.post(
        "datasets/upload",
        headers=user["headers"],
        data={
            "name": "CSRF Upload Allowed",
            "description": "Allowed multipart request",
        },
        files={
            "file": (
                "allowed.csv",
                CSV_BYTES,
                "text/csv",
            )
        },
    )
    assert allowed.status_code == 201, allowed.text

    foreign = api_client.post(
        "datasets/upload",
        headers={
            **_cookie_header(user),
            "Origin": FOREIGN_ORIGIN,
        },
        data={
            "name": "CSRF Upload Blocked",
            "description": "This must never reach upload logic",
        },
        files={
            "file": (
                "blocked.csv",
                CSV_BYTES,
                "text/csv",
            )
        },
    )
    assert foreign.status_code == 403
    assert foreign.json()["detail"] == "Invalid request origin"
