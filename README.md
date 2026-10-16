# DataPlatform

A full-stack analytics workspace for private CSV datasets, SQL queries, saved notebooks, browser-based Python analysis, and interactive dashboards.

## Hosted application

- App: https://dataplatform.sprout-sql.com
- Vercel alias: https://dataplatform-v1.vercel.app
- Vercel hosts the React/Vite frontend and FastAPI backend, configured by `vercel.json`.
- Supabase provides PostgreSQL and the private `datasets` Storage bucket. The hosted upload cap is 50,000,000 bytes.
- Authentication belongs to this FastAPI application. Using Supabase for its database and storage does not make this a Supabase Auth application.
- The frontend uses the same-origin `/api/v1` API. Private uploads transfer directly to Supabase through signed, resumable TUS requests.
- Notebook Python runs in a browser worker using the self-hosted Pyodide assets in `frontend/public/pyodide/314.0.7/`. Python is not executed inside the API process.

Docker Desktop is needed for local container development, tests and container-based migration commands. It does not need to remain open to serve the hosted application.

## Features and current validation

- Register/login/logout with backend-owned sessions and ownership checks.
- Durable dataset upload intents, private storage, dataset preview and SQL execution through DuckDB.
- Saved SQL/Python notebooks and bounded browser dataset snapshots.
- Dashboard builder/viewer with movable and resizable widgets, duplicate, undo/redo, locking and optimistic conflict handling.
- Bar, horizontal bar, line, area, stacked bar, stacked area, pie, donut, scatter and combo charts; table/metric presentation controls; column selectors populated from query-result fields.
- Light/dark themes and responsive layouts.

The latest supplied deployment health responses are HTTP 200 for both `/health/live` and `/health/ready`, with database and migration checks OK. Historical phase documents retain their original evidence. See [the current synchronization status](docs/phases/cloud/CLOUD_GITHUB_SYNC_STATUS.md) for what has and has not been accepted live.

Connected server-side filters/slicers and email ownership verification are planned work; they are not claimed as implemented features.

## Cloud setup and deployment

1. Read [the cloud deployment runbook](docs/CLOUD_DEPLOYMENT_RUNBOOK.md) and [dataset integration runbook](docs/phases/cloud/CLOUD_INTEGRATION_RUNBOOK.md).
2. Configure backend secrets in the hosting environment using the placeholders in `backend/.env.cloud.example`. Set the frontend build variable `VITE_API_URL=/api/v1`.
3. Apply database migrations deliberately using the runbook. Deployment does not automatically migrate a database.
4. Deploy from the repository root using the existing Vercel project:

```powershell
npx.cmd --yes vercel@63.1.2 deploy --prod --scope deepanshu1927
```

The Vercel CLI deploys local source. Saving changes on GitHub requires a separate Git commit and push. Automatic Git deployments were not enabled during the recorded setup.

Do not commit real environment files, passwords, API keys, session tokens or uploaded datasets. The committed `.example` configuration files contain placeholders only.

## Local development and tests

Supported Compose entrypoints, run from the repository root:

- `docker-compose.yml`: local development.
- `docker-compose.test.yml`: isolated tests with a disposable test database.
- `docker-compose.prod.yml` plus a private `production.env`: the separate container-hosted topology.

The Compose production topology is an alternative to the currently hosted Vercel/Supabase deployment. Do not run migration commands against the hosted database as part of routine tests.

For local development, copy `.env.example` to `.env`, replace the development secret with a generated value, and run:

```powershell
docker compose build
docker compose up
```

Local app: http://localhost:5173. Local backend: http://localhost:8000.

Frontend tests and lint:

```powershell
npm.cmd --prefix .\frontend test -- --maxWorkers=2 --testTimeout=15000
npm.cmd --prefix .\frontend run lint
```

The cloud build wrapper is `frontend/scripts/build-vercel.mjs`; it builds and verifies the same-origin API configuration, editor sanitizer and shipped browser Python assets. `frontend/build/editorSanitizer.ts` is required build source, not generated output.

Dashboard verification helpers live in `scripts/verify-cloud-dashboard-presentation.ps1` and `scripts/verify-cloud-dashboard-column-selectors.ps1`. Use their runbooks and isolated test configuration rather than the hosted database.

## Source layout

| Path | Purpose |
| --- | --- |
| `backend/app` | API routes, authentication, configuration, data/storage services and database models |
| `backend/alembic` | Versioned database migrations |
| `backend/tests` | Backend unit and database integration tests |
| `frontend/src` | Application, notebooks, dashboard builder and shared viewer rendering |
| `frontend/build` | Source for build-time editor sanitization checks |
| `frontend/public` | Static assets and self-hosted browser Python runtime |
| `frontend/scripts` | Cloud build wrapper |
| `scripts` | Verification and local operational helpers |
| `docs` | Deployment runbooks, phase scope and historical validation evidence |
