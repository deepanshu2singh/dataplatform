from __future__ import annotations

from typing import Iterable
from urllib.parse import urlsplit

from starlette.datastructures import Headers
from starlette.responses import JSONResponse


SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def normalize_origin(value: str | None) -> str | None:
    if not value:
        return None

    candidate = value.strip()

    if not candidate or candidate.lower() == "null":
        return None

    try:
        parsed = urlsplit(candidate)
        port = parsed.port
    except ValueError:
        return None

    scheme = parsed.scheme.lower()

    if (
        scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or parsed.path not in {"", "/"}
    ):
        return None

    host = parsed.hostname.lower()

    if ":" in host and not host.startswith("["):
        host = f"[{host}]"

    if (
        (scheme == "http" and port == 80)
        or (scheme == "https" and port == 443)
    ):
        port = None

    port_suffix = f":{port}" if port is not None else ""

    return f"{scheme}://{host}{port_suffix}"


class OriginCSRFMiddleware:
    """Reject unsafe API requests unless they come from a trusted origin.

    This middleware intentionally validates only request metadata. It never
    reads or buffers the request body, so multipart dataset uploads continue
    to stream normally.

    Trusted origins are:
    - the configured frontend origin; and
    - the API's own request origin, which preserves same-origin Swagger usage.

    Unsafe requests without an Origin header fail closed.
    """

    def __init__(
        self,
        app,
        *,
        frontend_origin: str,
        api_prefix: str,
    ) -> None:
        self.app = app
        self.api_prefix = api_prefix.rstrip("/") or "/"

        normalized_frontend = normalize_origin(frontend_origin)

        if normalized_frontend is None:
            raise ValueError("FRONTEND_URL must be a valid HTTP(S) origin")

        self.frontend_origin = normalized_frontend

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        method = str(scope.get("method", "")).upper()
        path = str(scope.get("path", ""))

        if method in SAFE_METHODS or not path.startswith(self.api_prefix):
            await self.app(scope, receive, send)
            return

        headers = Headers(scope=scope)
        supplied_origins = headers.getlist("origin")

        if len(supplied_origins) != 1:
            await self._reject(scope, receive, send)
            return

        request_origin = normalize_origin(supplied_origins[0])
        own_origin = self._request_target_origin(scope, headers)

        trusted_origins = {self.frontend_origin}

        if own_origin is not None:
            trusted_origins.add(own_origin)

        if request_origin not in trusted_origins:
            await self._reject(scope, receive, send)
            return

        await self.app(scope, receive, send)

    @staticmethod
    def _request_target_origin(scope, headers: Headers) -> str | None:
        host = headers.get("host")

        if not host:
            return None

        scheme = str(scope.get("scheme", "http")).lower()

        return normalize_origin(f"{scheme}://{host}")

    @staticmethod
    async def _reject(scope, receive, send) -> None:
        response = JSONResponse(
            status_code=403,
            content={"detail": "Invalid request origin"},
        )
        await response(scope, receive, send)
