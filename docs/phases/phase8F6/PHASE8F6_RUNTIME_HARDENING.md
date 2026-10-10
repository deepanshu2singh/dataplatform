# Phase 8F.6 — Runtime Privilege & Filesystem Hardening

## Baseline gate

Phase 8F.6 is built only from the completed `phase8F5-production-verified` checkpoint.

Baseline `docker-compose.prod.yml` SHA-256:

`FD0F65B56B9F493575CBFD19F70D4DC12D19039219877CF92A5FCEFF9BC793FE`

Approved Phase 8F.6 `docker-compose.prod.yml` SHA-256:

`C14B8ED1A47EB8CF830EC7C140E8CBB87D0E7D184D8DECBA574466B11CD6B67B`

See `LINEAGE_AUDIT.md` for the Phase 8E → Phase 8F.5 source-continuity audit and affected-component analysis.

## Objective

Reduce container runtime privilege and writable filesystem surface without changing:

- backend/frontend application code
- API behavior
- database schema or intended data
- image contents
- production network topology
- authentication/session behavior
- the Caddy/TLS edge
- dataset persistence

## Functional source scope

Exactly one production source file changes:

- `docker-compose.prod.yml`

The following are explicitly unchanged:

- backend application source
- frontend application source
- Alembic migration files
- development `docker-compose.yml`
- test `docker-compose.test.yml`
- production Dockerfiles
- production Nginx configuration

## Permanent runtime policy

### `frontend`

- `read_only: true`
- tmpfs-backed `/tmp`
- `security_opt: no-new-privileges:true`
- `cap_drop: ALL`
- retains existing `nginx` runtime user

### `backend`

- `read_only: true`
- tmpfs-backed `/tmp`
- `security_opt: no-new-privileges:true`
- `cap_drop: ALL`
- retains existing `appuser` runtime user
- existing `uploads_data:/app/uploads` named volume remains writable

### `migrate`

- `read_only: true`
- tmpfs-backed `/tmp`
- `security_opt: no-new-privileges:true`
- `cap_drop: ALL`
- retains existing `appuser` runtime user

### `postgres`

- `read_only: true`
- tmpfs-backed `/tmp`
- tmpfs-backed `/var/run/postgresql`
- `security_opt: no-new-privileges:true`
- `cap_drop: ALL`
- restores only `CHOWN`, `DAC_OVERRIDE`, `FOWNER`, `SETGID`, `SETUID`
- existing `postgres_data:/var/lib/postgresql/data` named volume remains writable

## Pre-implementation evidence already completed

These were used to validate the design and are not intended to become an open-ended test loop:

- hardened migration execution: PASS
- hardened backend health/filesystem boundaries: PASS
- hardened frontend health/filesystem boundaries: PASS
- PostgreSQL fresh empty-volume initialization under final capability set: PASS
- PostgreSQL restart with initialized PGDATA: PASS
- PostgreSQL PGDATA and socket-directory writes as `postgres`: PASS
- PostgreSQL root filesystem write blocked: PASS
- production logical backup created: PASS
- host-side backup archive parsed by `pg_restore -l`: PASS

## Controlled implementation sequence

1. `apply-phase8F6-runtime-hardening.ps1`
   - checks the Phase 8F.5 baseline hash
   - verifies the approved patch hash
   - creates/validates `docker-compose.prod.pre-8f6.yml`
   - installs the final Compose file
   - runs `docker compose config --quiet`
   - does not recreate containers

2. `deploy-phase8F6-runtime-hardening.ps1`
   - validates the final Compose hash
   - creates a fresh pre-deployment PostgreSQL custom-format dump
   - validates the host-side dump using a clean PostgreSQL utility container
   - captures user/dataset/notebook/dashboard row counts and Alembic revision
   - recreates only PostgreSQL, migration, backend, frontend in dependency order
   - waits for required health/exit states
   - compares database counts and Alembic revision before/after

3. `verify-phase8F6-runtime-hardening.ps1`
   - executes the single automated acceptance matrix

4. Manual authenticated browser regression
   - login
   - open existing dataset
   - execute saved notebook SQL
   - dashboard `Refresh Data`
   - logout

Only after all four gates pass should a full Phase 8F.6 checkpoint be created.

## Acceptance matrix

| Requirement | Pass condition |
|---|---|
| Compose | config validation exits 0 |
| PostgreSQL | healthy and `pg_isready` passes |
| Migration | exit code 0 |
| Backend | healthy |
| Frontend | healthy |
| DB preservation | users/datasets/notebooks/dashboards counts unchanged |
| Alembic | revision unchanged at expected head |
| Backend root FS | read-only |
| Backend upload storage | writable |
| Frontend root FS | read-only |
| PostgreSQL root FS | read-only |
| PostgreSQL PGDATA/socket/tmp | writable where intended |
| Privilege escalation | `no-new-privileges` on all four services |
| Capabilities | ALL dropped; only PostgreSQL startup set restored |
| Exposure | backend/PostgreSQL not host-published |
| HTTPS API | trusted production OpenAPI request returns 200 |
| Authenticated browser | login → dataset → notebook → dashboard refresh → logout passes |

## Rollback

`rollback-phase8F6-runtime-hardening.ps1` restores the exact Phase 8F.5 Compose file and recreates the four production services while preserving named volumes.

The rollback script intentionally does **not** restore a database dump automatically. A runtime-policy rollback does not require data replacement, and automatically overwriting the database would be unnecessarily destructive. The pre-deployment dump is retained only as an emergency recovery artifact.
