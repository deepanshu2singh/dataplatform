# Phase 8F.4 production Compose and network architecture

This phase adds a separate production Compose stack and leaves the development
`docker-compose.yml` untouched.

## Service flow

frontend (only host-published app service)
  -> edge network
backend
  -> data network
postgres

The one-shot `migrate` service is attached only to the private data network and
must complete successfully before the backend is started. The frontend waits for
backend readiness.

## Network exposure

- PostgreSQL has no host `ports`.
- Backend has no host `ports`; `expose: 8000` is Docker-network metadata only.
- Frontend is the only host-published service.
- The frontend binds to 127.0.0.1:8080 by default so a host-level TLS reverse
  proxy can be the public HTTPS edge.
- The data network is `internal: true`; PostgreSQL and migrations are not on the
  frontend-facing edge network.

## Secrets

Production values are loaded with:

`docker compose --env-file production.env -f docker-compose.prod.yml ...`

`production.env` is already ignored by the repository's `*.env` rule. The
helper script generates URL-safe random hexadecimal values locally and does not
print them.

For this local topology test the helper defaults FRONTEND_URL to
`https://app.example.test`. That satisfies the backend's production fail-closed
configuration, but browser login over plain `http://localhost:8080` is not
expected to work because production cookies are Secure and CSRF requires the
real HTTPS frontend origin. Full HTTPS/browser validation belongs to the later
production smoke phase.
