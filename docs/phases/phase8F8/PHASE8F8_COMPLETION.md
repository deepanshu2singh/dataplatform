# Phase 8F.8 - Deployment Surface Consolidation

Status: COMPLETE

Completion date: 2026-10-08

## Parent checkpoint

phase8F7-complete.zip

SHA-256:

7276CF7E0089833BFE018E3E56F5B9CFE5589590D5E283D7AB1B51C261232458

## Objective

Remove the obsolete nested frontend Docker Compose entrypoint and make the repository deployment surface unambiguous.

## Intentional existing-file changes

- README.md updated to document the canonical root Compose entrypoints.
- frontend/docker-compose.yml removed because it was obsolete and unsafe as an alternative orchestration entrypoint.

## Canonical Compose entrypoints

- docker-compose.yml - development
- docker-compose.test.yml - isolated testing
- docker-compose.prod.yml - production

## Accepted hashes

README.md:
15FE763A279448E1B7719529EB4C6D5CFC59C1DCF592D81592A19ADEEBC2528D

docker-compose.yml:
1896C28692A7C68405A54A0F2C745C14BBF25E60DF8F411D67705EFB8649943A

docker-compose.test.yml:
70A9192A44E74689B08E46ACEA8C44A643A73E45CFAD814D1C976FC59F48A5D8

docker-compose.prod.yml:
9EB5408452AC3E615B4E9348B2B912AD2783694E437EE1D418A0D7D6387A6A20

production.env.example:
5261323E7CB672E685E7D5ACECA4C37D77C71543BC2C1D61382C74EE45F22834

## Acceptance

- Phase 8F.8 baseline gate: PASS
- Source-change gate: PASS
- Development Compose validation: PASS
- Test Compose validation: PASS
- Production Compose validation: PASS
- Final static check: PASS
- Obsolete frontend Compose file absent: PASS
- Nested backend/frontend Compose entrypoints absent: PASS

## Runtime impact

Docker containers changed: NO

Database changed: NO

Browser regression required: NO

Production runtime configuration changed: NO

## Scope exclusions

No backend application source was changed.

No frontend application source under frontend/src was changed.

No database schema or data was changed.

No production Compose configuration was changed.

No authentication, networking, volume, resource-limit, or runtime-hardening behaviour was changed.

Caddy remains separately managed and outside Phase 8F.8.

