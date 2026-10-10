from __future__ import annotations

import json
import logging
import re
import time
import traceback
from contextvars import ContextVar, Token
from datetime import datetime, timezone
from pathlib import Path
from types import TracebackType
from uuid import uuid4

from starlette.datastructures import Headers, MutableHeaders
from starlette.responses import JSONResponse


REQUEST_ID_HEADER = "X-Request-ID"
GENERIC_SERVER_ERROR_DETAIL = "An unexpected server error occurred."
MAX_REQUEST_ID_LENGTH = 64
MAX_LOG_TEXT_LENGTH = 8_000
_REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,64}$")

_request_id_context: ContextVar[str | None] = ContextVar(
    "request_id",
    default=None,
)

_REQUEST_LOGGER = logging.getLogger("app.request")

# Redaction is a second line of defense. Application/domain log calls should
# still avoid placing credentials, user SQL/Python source, uploaded data, or
# arbitrary request content into log messages in the first place.
_REDACTION_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (
        re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+\-/=]+"),
        "Bearer [REDACTED]",
    ),
    (
        re.compile(r"(?i)\bAuthorization\s*[:=]\s*[^\r\n]+"),
        "Authorization=[REDACTED]",
    ),
    (
        re.compile(r"(?i)\bCookie\s*[:=]\s*[^\r\n]+"),
        "Cookie=[REDACTED]",
    ),
    (
        re.compile(r"(?i)\bdataplatform_session\s*=\s*[^\s;,]+"),
        "dataplatform_session=[REDACTED]",
    ),
    (
        re.compile(
            r"(?i)\b(?:SECRET_KEY|DATABASE_URL|PASSWORD|PASSWD|TOKEN|API[_-]?KEY)"
            r"\s*[:=]\s*[^\s,;]+"
        ),
        "[REDACTED_SECRET]",
    ),
    (
        re.compile(
            r"(?i)\b(postgresql(?:\+asyncpg)?://)([^:\s/@]+):([^@\s/]+)@"
        ),
        r"\1\2:[REDACTED]@",
    ),
    (
        re.compile(
            r"(?i)(?:[A-Za-z]:\\[^\r\n\"']*\\uploads\\[^\s\"']+|"
            r"/(?:[^/\s\"']+/)*uploads/[^\s\"']+)"
        ),
        "[REDACTED_UPLOAD_PATH]",
    ),
)


def get_request_id() -> str | None:
    """Return the request ID bound to the current request context."""

    return _request_id_context.get()


def sanitize_log_text(value: object) -> str:
    """Return a bounded, redacted representation suitable for application logs.

    This intentionally targets common credential/session forms and uploaded-data
    paths. It is not a license to log arbitrary request bodies or user code: the
    application should avoid those values entirely and use this as defense in
    depth for accidental exception/message leakage.
    """

    text = str(value)

    for pattern, replacement in _REDACTION_PATTERNS:
        text = pattern.sub(replacement, text)

    if len(text) > MAX_LOG_TEXT_LENGTH:
        text = f"{text[:MAX_LOG_TEXT_LENGTH]}...[TRUNCATED]"

    return text


def _select_request_id(headers: Headers) -> str:
    """Accept one safe correlation ID or generate a server-controlled one."""

    supplied = headers.getlist(REQUEST_ID_HEADER)

    if len(supplied) == 1:
        candidate = supplied[0].strip()

        if (
            len(candidate) <= MAX_REQUEST_ID_LENGTH
            and _REQUEST_ID_PATTERN.fullmatch(candidate)
        ):
            return candidate

    return uuid4().hex


def _safe_exception_traceback(
    exc_type: type[BaseException] | None,
    tb: TracebackType | None,
) -> str:
    """Format a useful traceback without serializing exception values.

    Exception strings are attacker/user-influenced in many libraries: database
    drivers may include SQL and parameters, filesystem errors include paths,
    and user-code exceptions can contain arbitrary content. We therefore keep
    the exception class and stack locations but deliberately omit the exception
    value and source-code line text.
    """

    lines = ["Traceback (most recent call last):"]

    if tb is not None:
        frames = traceback.extract_tb(tb)[-20:]
        for frame in frames:
            lines.append(
                f'  File "{Path(frame.filename).name}", '
                f"line {frame.lineno}, in {frame.name}"
            )

    lines.append(exc_type.__name__ if exc_type is not None else "Exception")
    return "\n".join(lines)


class JSONLogFormatter(logging.Formatter):
    """Format application log records as one safe JSON object per line.

    Only explicitly selected attributes are serialized. Request headers,
    cookies, bodies, query strings, passwords, tokens, user SQL/Python source,
    uploaded data, and arbitrary LogRecord extras are intentionally excluded.
    """

    _STRUCTURED_FIELDS = (
        "event",
        "http_method",
        "path",
        "status_code",
        "duration_ms",
        "resource_type",
        "resource_id",
        "user_id",
        "reason",
        "operation",
    )

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "timestamp": datetime.now(timezone.utc)
            .isoformat(timespec="milliseconds")
            .replace("+00:00", "Z"),
            "level": record.levelname,
            "logger": record.name,
            "message": sanitize_log_text(record.getMessage()),
        }

        request_id = getattr(record, "request_id", None) or get_request_id()

        if request_id:
            payload["request_id"] = request_id

        for field in self._STRUCTURED_FIELDS:
            value = getattr(record, field, None)

            if value is not None:
                payload[field] = (
                    sanitize_log_text(value)
                    if isinstance(value, str)
                    else value
                )

        if record.exc_info:
            exc_type, _exc_value, tb = record.exc_info
            payload["exception_type"] = (
                exc_type.__name__ if exc_type is not None else "Exception"
            )
            payload["exception"] = _safe_exception_traceback(exc_type, tb)

        return json.dumps(
            payload,
            ensure_ascii=False,
            separators=(",", ":"),
        )


def configure_application_logging(level: str = "INFO") -> None:
    """Configure JSON logging for this application's own logger namespace."""

    app_logger = logging.getLogger("app")
    handler = logging.StreamHandler()
    handler.setFormatter(JSONLogFormatter())

    app_logger.handlers.clear()
    app_logger.addHandler(handler)
    app_logger.setLevel(level.upper())
    app_logger.propagate = False


class RequestLoggingMiddleware:
    """Attach a request ID and emit one safe structured request log."""

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = Headers(scope=scope)
        request_id = _select_request_id(headers)
        token: Token[str | None] = _request_id_context.set(request_id)

        method = str(scope.get("method", "")).upper()
        path = str(scope.get("path", ""))
        status_code = 500
        started = time.perf_counter()

        async def send_with_request_id(message) -> None:
            nonlocal status_code

            if message["type"] == "http.response.start":
                status_code = int(message["status"])
                response_headers = MutableHeaders(scope=message)
                response_headers[REQUEST_ID_HEADER] = request_id

            await send(message)

        try:
            await self.app(scope, receive, send_with_request_id)
        except Exception:
            duration_ms = round((time.perf_counter() - started) * 1000, 2)
            _REQUEST_LOGGER.exception(
                "HTTP request failed",
                extra={
                    "event": "http_request_failed",
                    "http_method": method,
                    "path": path,
                    "status_code": 500,
                    "duration_ms": duration_ms,
                    "request_id": request_id,
                },
            )

            response = JSONResponse(
                status_code=500,
                content={
                    "detail": GENERIC_SERVER_ERROR_DETAIL,
                    "request_id": request_id,
                },
            )
            await response(scope, receive, send_with_request_id)
            return
        else:
            duration_ms = round((time.perf_counter() - started) * 1000, 2)
            log_method = (
                _REQUEST_LOGGER.error
                if status_code >= 500
                else _REQUEST_LOGGER.info
            )
            log_method(
                "HTTP request completed",
                extra={
                    "event": "http_request_completed",
                    "http_method": method,
                    "path": path,
                    "status_code": status_code,
                    "duration_ms": duration_ms,
                    "request_id": request_id,
                },
            )
        finally:
            _request_id_context.reset(token)
