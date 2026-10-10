# Phase 8F.6 — Runtime Privilege & Filesystem Hardening

Status: COMPLETE

Completion timestamp: 2026-10-08 00:27:49

## Acceptance gates

Phase 8F.6 source gate: PASS

Phase 8F.6 deployment gate: PASS

Phase 8F.6 automated acceptance gate: PASS

Authenticated browser regression: PASS

## Automated acceptance evidence

HTTPS OpenAPI: 200

PostgreSQL:
accepting connections

Backend readiness:
database = ok
migrations = ok

Frontend health:
ok

Migration service:
fresh hardened runtime probe passed

Alembic:
upgrade head passed

## Browser regression

Existing persisted production state was successfully exercised through:

login
-> existing dataset
-> existing notebook SQL execution
-> existing dashboard Refresh Data
-> logout

## Approved production Compose

SHA-256:

C14B8ED1A47EB8CF830EC7C140E8CBB87D0E7D184D8DECBA574466B11CD6B67B

## Canonical Phase 8F.6 verifier

SHA-256:

8C3558DB88858ED03F249F1F7A57C8FD2D51E361084CC3B8931804F0B70D53E5


## Checkpoint artifact correction

The first Phase 8F.6 checkpoint artifact was superseded after post-freeze audit.

Artifact-only corrections:

- restored the application root README from the verified Phase 8F.5 baseline
- restored PHASE8F2_RUNTIME_PID_FIX.md
- restored PHASE8F5_PRODUCTION_VERIFIED.md
- changed ZIP generation to standards-compatible forward-slash entry paths

Superseded checkpoint SHA-256:

EAE4CD9B7F8A655EC940AC2378FABD7C660FF5BF2647362194144B975F5A3822

No backend/frontend application source, production Compose configuration,
database state, production environment, or accepted runtime behavior changed
during this correction.
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
- reconciliation archives
- historical checkpoint ZIPs
- rollback-only Compose configuration
- ad-hoc smoke CSV files
