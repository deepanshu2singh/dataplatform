# Phase 8F.6 lineage audit

## Inputs inspected

- User-provided full checkpoint: `databricks-clone-v1-phase8E-complete.zip`
- Phase 8F.5 verified production checkpoint: `phase8F5-production-verified.zip`

## Source continuity result

A SHA-256 comparison was performed across every path present in both checkpoints.

- Phase 8E files: 174
- Phase 8F.5 files: 164
- Common paths: 149
- Common paths with different bytes: **0**

All 149 common files are byte-for-byte identical.

The 15 files present only in Phase 8F.5 are the production/deployment layer and its documentation:

- `CHECKPOINT_SHA256.txt`
- `Caddyfile.local.example`
- `PHASE8F1_DEPLOYMENT_AUDIT.md`
- `PHASE8F2_PRODUCTION_FRONTEND.md`
- `PHASE8F2_RUNTIME_PID_FIX.md`
- `PHASE8F3_PRODUCTION_BACKEND.md`
- `PHASE8F3_SOURCE_NOTES.md`
- `PHASE8F4_PRODUCTION_COMPOSE.md`
- `PHASE8F5_PRODUCTION_VERIFIED.md`
- `backend/Dockerfile.prod`
- `docker-compose.prod.yml`
- `frontend/Dockerfile.prod`
- `frontend/nginx.prod.conf`
- `production.env.example`
- `scripts/create-production-env.ps1`

This establishes Phase 8F.5 as the Phase 8E application source plus the audited Phase 8F production layer, with no application-code drift in shared files.

## Phase 8F.6 dependency audit

The hardening change affects only `docker-compose.prod.yml`.

### Backend

- Production image runs as `appuser`.
- Application writes uploaded datasets only beneath `settings.UPLOAD_DIR`.
- Production maps `UPLOAD_DIR=/app/uploads`.
- `uploads_data:/app/uploads` is a named volume and remains writable when the container root filesystem is read-only.
- SQL execution validates dataset paths remain under the configured upload root before reading them.
- Unsafe server-side Python execution remains disabled in production.

Therefore the backend needs writable `/tmp` and `/app/uploads`; application code and the rest of the image can be immutable.

### Frontend

- Production image runs as `nginx` and listens on unprivileged port 8080.
- Nginx PID and all configured runtime temp paths are already under `/tmp`.
- `/usr/share/nginx/html` and `/etc/nginx` contain static assets/configuration only.

Therefore the frontend needs writable `/tmp` only.

### Migration job

- Uses the backend production image and therefore runs as `appuser`.
- Alembic reads application/migration source and writes schema changes to PostgreSQL, not the image filesystem.
- Writable `/tmp` is retained for normal runtime temporary use.

### PostgreSQL

- Persistent state is in `postgres_data:/var/lib/postgresql/data`.
- The official image needs writable `/tmp` and `/var/run/postgresql`.
- Fresh-volume initialization and subsequent restart were proven with a read-only root filesystem, `cap_drop: ALL`, and only these startup capabilities restored: `CHOWN`, `DAC_OVERRIDE`, `FOWNER`, `SETGID`, `SETUID`.

### Network/TLS

- Backend and PostgreSQL remain internal-only and are not host-published.
- The internal `data` network remains unchanged.
- The Caddy TLS edge is outside this Compose project and is intentionally untouched by Phase 8F.6.
