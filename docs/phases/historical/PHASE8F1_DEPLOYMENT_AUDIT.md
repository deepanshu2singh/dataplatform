# Phase 8F.1 deployment audit

## What is already good

- PostgreSQL is not published to the host in the root Compose file.
- The backend image already runs as non-root UID 10001.
- The backend has separate liveness/readiness endpoints.
- Readiness checks both PostgreSQL connectivity and Alembic head state.
- Production backend settings fail closed for insecure SECRET_KEY, HTTP FRONTEND_URL, and insecure auth cookies.
- Server-side arbitrary Python remains disabled by default.
- Test Compose is isolated from the development stack.

## Main production blockers found

1. Root `docker-compose.yml` is a development stack:
   - Vite dev server on port 5173.
   - Uvicorn `--reload`.
   - Source bind mounts for backend/frontend.
   - frontend node_modules volume.

2. There is no separate production Compose definition.

3. Frontend has no production static web-server image and no SPA fallback/proxy layer.

4. Both browser-facing frontend and backend ports are published in the development Compose file. In production only the edge/frontend service should normally be public.

5. Compose contains development fallback credentials:
   - PostgreSQL password falls back to `postgres`.
   - SECRET_KEY falls back to the known development secret.
   The backend correctly rejects the known secret in production, but a production Compose file should require secrets rather than provide fallbacks.

6. Backend migrations run in the same command as the API process. That is fine for one local instance but is the wrong shape for scaling because multiple replicas may try to migrate at startup.

7. Backend runtime image keeps `gcc` installed because build/runtime are one stage. This increases runtime image size and attack surface.

8. No restart policy, resource bounds, `no-new-privileges`, capability dropping, or read-only filesystem policy exists yet.

9. `.env.example` documents only development values and is not enough for a production deployment.

10. `frontend/docker-compose.yml` is a stale duplicate. From that directory its `./backend` build context is incorrect and it can confuse future deployment work.

11. Frontend API configuration currently defaults to an absolute localhost URL. A static production image should be built with same-origin `/api/v1` and let the edge server proxy it privately to the backend.

## Phase 8F target architecture

Internet / TLS edge
       |
       v
Production frontend Nginx (only public application container)
       |  /api/*
       v
Private FastAPI backend
       |
       v
Private PostgreSQL

A one-shot migration service will run before the API starts.

Development `docker-compose.yml` remains separate and keeps hot reload.
