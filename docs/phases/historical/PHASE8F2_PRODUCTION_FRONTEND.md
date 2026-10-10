# Phase 8F.2 production frontend

This patch adds a production-only frontend image. It does not replace the
existing development Dockerfile or development Compose workflow.

Files:
- `frontend/Dockerfile.prod`
- `frontend/nginx.prod.conf`

Key properties:
- Node is present only in the build stage.
- Runtime contains Nginx and compiled static files, not source/node_modules.
- Vite dev server is not used.
- Runs Nginx as the unprivileged `nginx` user on port 8080.
- `/api/*` is reverse-proxied to the private `backend:8000` service.
- `/healthz` provides a lightweight container health endpoint.
- React BrowserRouter routes fall back to `index.html`.
- Hashed Vite assets receive long-lived caching.
- `python-worker.mjs` is revalidated because its filename is not content hashed.
- Upload body allowance matches the backend's 100 MiB application limit.
- Basic response hardening headers are included.
