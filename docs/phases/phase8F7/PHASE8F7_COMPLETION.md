# Phase 8F.7 — Production Resource Governance

Status: COMPLETE

Completion date: 2026-10-08

Parent checkpoint:

phase8F6-complete.zip

Parent SHA-256:

210537667758EA1E74B08086C6A81C03E755C2032BE4926C0042162304CDF2C5

## Objective

Prevent a single production Compose service from exhausting the Docker host's
CPU, memory, or process capacity while preserving all accepted Phase 8F.6
runtime-hardening and application behaviour.

## Accepted production resource policy

| Service | CPU | Memory | PID limit |
| --- | ---: | ---: | ---: |
| PostgreSQL | 1.0 | 512 MiB | 128 |
| Migrate | 1.0 | 384 MiB | 64 |
| Backend | 2.0 | 1536 MiB | 128 |
| Frontend | 0.5 | 256 MiB | 64 |

## Acceptance gates

Phase 8F.7 source gate: PASS

Pre-deployment recovery gate: PASS

Engine-level resource inspection: PASS

Database persistence gate: PASS

Inherited Phase 8F.6 hardening regression: PASS

Phase 8F.7 automated acceptance gate: PASS

Authenticated browser regression: PASS

## Approved production configuration

docker-compose.prod.yml SHA-256:

9EB5408452AC3E615B4E9348B2B912AD2783694E437EE1D418A0D7D6387A6A20

production.env.example SHA-256:

5261323E7CB672E685E7D5ACECA4C37D77C71543BC2C1D61382C74EE45F22834

## Canonical Phase 8F.7 verifier

scripts/verify-phase8F7-resource-governance.ps1

SHA-256:

ABC956B9389C1DC67A5FEC2AAC8CBACA46B93D657D7616D08FDC9A32F771840A

## Phase 8F.7 source-application script

scripts/apply-phase8F7-resource-governance.ps1

SHA-256:

CE5F8876AAEC3DC6FC5D75D9877EEFDE657DBCA850FF58D4D42BC723E5C1DE1F

## Database recovery evidence

Pre-deployment backup:

phase8f7-pre-resource-governance-20261008-011723.dump

Backup size:

15438 bytes

Backup SHA-256:

11141E7E5ADBAE9B509CEA52BE12BB1EE0F45F9F843584457D9FF745FE8B1D4B

The backup is intentionally excluded from this source checkpoint.

Pre-deployment database state:

users|datasets|notebooks|dashboards

1|1|1|1

Post-deployment database state:

1|1|1|1

Alembic revision before and after deployment:

20261006_0004

## Runtime acceptance evidence

PostgreSQL:

- NanoCpus = 1000000000
- Memory = 536870912 bytes
- PidsLimit = 128
- OOMKilled = false
- healthy

Migrate:

- NanoCpus = 1000000000
- Memory = 402653184 bytes
- PidsLimit = 64
- OOMKilled = false
- ExitCode = 0
- appuser

Backend:

- NanoCpus = 2000000000
- Memory = 1610612736 bytes
- PidsLimit = 128
- OOMKilled = false
- healthy

Frontend:

- NanoCpus = 500000000
- Memory = 268435456 bytes
- PidsLimit = 64
- OOMKilled = false
- healthy

Inherited Phase 8F.6 runtime controls remained accepted:

- read-only root filesystems
- writable-path boundaries
- no-new-privileges
- capability restrictions
- non-root application containers
- production network boundaries
- PostgreSQL capability policy
- migration hardening
- readiness/health behaviour

## Browser regression

The existing persisted production state was exercised successfully through:

login
-> Production Sales Smoke Test dataset
-> existing notebook SQL execution
-> Production Sales Dashboard Refresh Data
-> logout
-> protected-route redirect

Expected SQL output remained:

Laptop      3600.49
Monitor      899.97
Keyboard     374.95
Mouse        239.92

## Scope confirmation

Existing functional/configuration files changed by Phase 8F.7:

- docker-compose.prod.yml
- production.env.example

New Phase 8F.7 tooling/documentation:

- scripts/apply-phase8F7-resource-governance.ps1
- scripts/verify-phase8F7-resource-governance.ps1
- scripts/create-phase8F7-full-checkpoint.ps1
- docs/phases/phase8F7/PHASE8F7_COMPLETION.md

No backend application source, frontend application source, database schema,
database data model, Dockerfile, Nginx configuration, authentication logic,
volume topology, or production network topology was intentionally changed.

Caddy remains intentionally outside the Compose-managed resource-governance
scope and is not claimed as hardened by Phase 8F.7.

## Checkpoint exclusions

This checkpoint intentionally excludes:

- production secrets
- local .env files
- machine-local TLS certificates
- database backups
- runtime state
- uploaded runtime data
- node_modules
- frontend dist
- coverage output
- Python caches
- test caches
- reconciliation/archive material
- prior checkpoint ZIPs
- rollback-only Compose configuration
- ad-hoc smoke CSV files