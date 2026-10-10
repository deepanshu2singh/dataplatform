# Phase 8F.3 production backend image

This phase adds `backend/Dockerfile.prod` and intentionally leaves the existing
development `backend/Dockerfile` unchanged.

## Production-image changes

- Uses a two-stage Python build.
- `gcc` exists only in the build stage and is absent from the runtime image.
- Python dependencies are installed into `/opt/venv` and copied into runtime.
- The final image contains application code and Alembic migrations, not the
  backend test suite.
- Runtime remains non-root as UID 10001 (`appuser`).
- Uvicorn runs without `--reload`.
- Uvicorn access logging stays disabled because application request logging is
  already structured by `RequestLoggingMiddleware`.
- SIGTERM is used for container shutdown and Uvicorn receives a 30-second
  graceful-shutdown allowance.
- Image-level health checks use `/health/live`; dependency-aware
  `/health/ready` remains available for Compose/orchestration readiness.
- Alembic is present in the image but is not executed by the API CMD. A
  one-shot production migration service will be added in the production
  Compose phase so API replicas do not race migrations at startup.

## Important production design

The same backend image can be used for:
- migration job: `alembic upgrade head`
- API service: the image's default Uvicorn CMD

The production Compose definition will make the API wait for the migration job
and PostgreSQL readiness before serving traffic.
