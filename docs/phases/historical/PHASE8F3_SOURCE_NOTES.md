# Phase 8F.3 source notes

The current development backend image installs `gcc` directly into its runtime
stage. Root Compose then overrides the image command with:

`alembic upgrade head && uvicorn ... --reload --no-access-log`

That is appropriate for the current local-development workflow but not for a
production deployment.

The production image added in this phase removes compiler tooling from runtime,
does not run migrations in API startup, and does not enable Uvicorn reload.
