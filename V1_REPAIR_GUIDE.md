# Clean V1 Repair Guide

## Goal
Get a reproducible local development stack running before adding or expanding features.

## What Phase 1 fixes
- Removes generated/platform-specific `node_modules`, `dist`, and Python cache files.
- Splits Dataset, Notebook, and Dashboard into separate SQLAlchemy model modules.
- Fixes missing `APIRouter` import.
- Fixes SQLAlchemy/Pydantic class-name collisions.
- Removes unused/broken Redis + Celery services from the V1 stack.
- Streams uploads instead of reading the entire file into RAM.
- Deletes the uploaded file when its dataset is deleted.
- Stops exposing the server filesystem path in dataset API responses.
- Adds actual Excel/Parquet reader dependencies.
- Makes Python kernel startup lazy and disables unsafe Python execution by default.
- Removes `text/html` from local Python output as a temporary XSS safeguard.
- Corrects frontend URL/port assumptions.
- Runs the backend container as a non-root user.

## Start V1 with Docker Desktop
From the project root:

```powershell
Copy-Item .env.example .env
```

Generate a development secret in PowerShell:

```powershell
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Put that value into `.env` as `SECRET_KEY=...`.

Then run:

```powershell
docker compose build --no-cache
docker compose up
```

Open:
- Frontend: http://localhost:5173
- Backend health: http://localhost:8000/health
- Swagger UI: http://localhost:8000/docs

## Important Python note
`ENABLE_UNSAFE_PYTHON=false` is intentional. The original implementation executes arbitrary Python inside the API container and is not suitable for a multi-user system. A later repair phase will replace it with isolated execution.
