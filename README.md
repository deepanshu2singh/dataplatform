# DataPlatform — Clean V1

A local-first analytics platform prototype with authentication, dataset uploads, DuckDB SQL, notebooks, and dashboard scaffolding.

## Current V1 scope

Working toward this verified flow:

1. Register/login
2. Upload a dataset
3. Inspect dataset metadata
4. Create and save a notebook
5. Run SQL against the selected dataset
6. Reopen saved work
7. Persist dashboard layouts/widgets
8. Add isolated Python execution

Python execution is **disabled by default** until it is moved out of the API container into an isolated execution environment.

## Stack

- Backend: FastAPI + SQLAlchemy + PostgreSQL
- SQL engine: DuckDB
- Frontend: React + TypeScript + Vite
- Orchestration: Docker Compose with explicit root development, test, and production entrypoints

## Canonical Docker Compose entrypoints

Run Compose commands from the repository root only. The supported entrypoints are:

- Development: `docker-compose.yml`
- Tests: `docker-compose.test.yml`
- Production: `docker-compose.prod.yml` with `production.env`

Do not add or invoke nested Compose files under `backend/` or `frontend/`.

Production startup:

```powershell
docker compose --env-file .\production.env -f .\docker-compose.prod.yml up -d
```

The current HTTPS/Caddy edge remains managed separately from the production Compose stack.

## Quick start — Windows / Docker Desktop

```powershell
Copy-Item .env.example .env
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Paste the generated value into `.env` as `SECRET_KEY=...`, then:

```powershell
docker compose build --no-cache
docker compose up
```

Open:

- App: http://localhost:5173
- Backend health: http://localhost:8000/health
- Swagger UI: http://localhost:8000/docs
- OpenAPI JSON: http://localhost:8000/api/v1/openapi.json

## Project structure

```text
backend/
  app/
    api/routes/
    core/
    db/
    models/
    schemas/
    services/
frontend/
  src/
docker-compose.yml       # development
docker-compose.test.yml  # tests
docker-compose.prod.yml  # production
V1_REPAIR_GUIDE.md
```

## Safety

Use `docker-compose.yml` only for local development and `docker-compose.test.yml` only for isolated tests. Production deployments use `docker-compose.prod.yml` with the production environment file and the accepted hardening controls. Python execution remains disabled by default until it is moved into an isolated execution environment.
