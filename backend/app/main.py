from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.exception_handlers import request_validation_exception_handler
from starlette.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import api_router
from app.core.config import settings
from app.core.cloud_response import CloudResponseLimitMiddleware
from app.core.csrf import OriginCSRFMiddleware
from app.core.health import get_readiness_status
from app.core.observability import (
    REQUEST_ID_HEADER,
    RequestLoggingMiddleware,
    configure_application_logging,
    get_request_id,
)
from app.db.session import engine



configure_application_logging(settings.LOG_LEVEL)


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await engine.dispose()


app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    lifespan=lifespan,
)


@app.exception_handler(RequestValidationError)
async def validation_error_response(request: Request, exc: RequestValidationError):
    if request.url.path == f"{settings.API_V1_STR}/auth/email-verification/confirm":
        # FastAPI's normal validation response can echo the submitted input.
        # A malformed pasted code must not appear in response/error telemetry.
        return JSONResponse(status_code=422, content={"detail": "Enter an eight-digit verification code"})
    return await request_validation_exception_handler(request, exc)

# Middleware ordering matters. Starlette executes the most recently added
# user middleware first, so add them from innermost to outermost:
# CSRF -> request observability/error boundary -> CORS.
#
# This lets request logging/correlation cover CSRF responses and unexpected
# failures, while the outer CORS layer can still decorate safe 500 responses
# for the configured frontend origin.
app.add_middleware(
    CloudResponseLimitMiddleware,
    enabled=settings.STORAGE_BACKEND == "supabase",
)

app.add_middleware(
    OriginCSRFMiddleware,
    frontend_origin=settings.FRONTEND_URL,
    api_prefix=settings.API_V1_STR,
)

app.add_middleware(RequestLoggingMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_URL],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=[REQUEST_ID_HEADER, "X-Email-Verification-Required"],
)

app.include_router(api_router, prefix=settings.API_V1_STR)


@app.get("/health")
async def health_check():
    # Compatibility endpoint retained for existing tooling. It remains a
    # lightweight process-level check; dependency-aware probes use /ready.
    return {"status": "healthy", "environment": settings.ENVIRONMENT}


@app.get("/health/live")
async def health_live():
    """Liveness: the API process/event loop can answer HTTP requests."""

    return {"status": "alive"}


@app.get("/health/ready")
async def health_ready():
    """Readiness: required dependencies and migration state can serve traffic."""

    ready, checks = await get_readiness_status()

    if ready:
        return {
            "status": "ready",
            "checks": checks,
        }

    payload: dict[str, object] = {
        "status": "not_ready",
        "checks": checks,
    }
    request_id = get_request_id()

    if request_id:
        payload["request_id"] = request_id

    return JSONResponse(status_code=503, content=payload)
