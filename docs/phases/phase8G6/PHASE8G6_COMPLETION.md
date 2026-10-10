# Phase 8G.6 — Final Browser Python Security Closure

**Status:** COMPLETE / FROZEN  
**Date:** 2026-10-09  
**Authoritative parent:** `checkpoints/phase8G5-complete.zip`  
**Parent SHA-256:** `33EDD582978FD532FCF24A37155384FEE0C5C8E28131A353DFC2BD16F71B3B20`

## Scope

Phase 8G.6 closes the remaining Python-security deployment gaps established by Phases 8G.2 through 8G.5.

No new Python execution architecture was introduced.

The phase completed two outstanding items:

1. tightened CSP Worker permissions from `worker-src 'self' blob:` to `worker-src 'self'`;
2. deployed the Phase 8G.2 backend retirement so the legacy server-side Python/Jupyter executor is physically absent from production.

## Frontend CSP closure

Modified:

`frontend/nginx.prod.conf`

Final SHA-256:

`CD7F7C4701D60212995808BEFD487D966A4D896C7EBB7E961BD670914F3197E9`

Final Worker policy:

`worker-src 'self';`

The unnecessary `blob:` Worker permission was removed.

Real Microsoft Edge acceptance proved:

- blob Workers are blocked;
- the same-origin `/python-worker.mjs` remains allowed;
- self-hosted Pyodide initializes;
- pandas 3.0.2 executes successfully;
- dataframe result remained correct.

Accepted browser marker:

`PHASE8G6B_BROWSER_PASS|BLOB_WORKER_BLOCKED|SAME_ORIGIN_WORKER_ALLOWED|PANDAS=3.0.2|SUM=6`

Accepted frontend image:

`sha256:576906cda53255e84e061f1edcdc5b334a8d1a4878edfb3bb453c2af8a0f911f`

Live frontend container:

`3292ec6f551bfdb2d29213aba621c7e57ec67163b86dc1317390a11f46e601e4`

Frontend rollback image:

`sha256:da3c7565d40ecc99027be2dd5c2a1ae3a59a0951e10906a772f535f6096ddd5a`

## Backend retirement closure

The legacy backend executor had already been removed from source in Phase 8G.2.

Phase 8G.6 validated and deployed that retirement.

Backend validation:

- targeted backend tests: 14/14 passed;
- full backend test suite: 120/120 passed;
- `backend/app/api/routes/python.py` absent;
- `backend/app/services/python_executor.py` absent;
- `jupyter-client` absent;
- `jupyter-core` absent;
- `ipykernel` absent.

Accepted backend image:

`sha256:57a2c991b0ed123082e350e071bfeeb24354abddad1edb346f8b572e356695cb`

Live backend container:

`801a5741070ed2c28f0e7cdd6dfef9bb6959af6caeab1befc450958122faa934`

Backend rollback image:

`sha256:67038bd4ddc488d24a49ea6124af9615de7dcf29b635be88b48a6c1d93773a6e`

Production OpenAPI confirms the legacy Python execution route is absent.

Therefore:

`BACKEND_8G2_DEPLOYED=True`

## Final production state

Frontend image:

`sha256:576906cda53255e84e061f1edcdc5b334a8d1a4878edfb3bb453c2af8a0f911f`

Backend image:

`sha256:57a2c991b0ed123082e350e071bfeeb24354abddad1edb346f8b572e356695cb`

Postgres container:

`fa288f7f87be7bda763b97bf001a5d9573abc93d3f6aad74df0a22be1ad0ff0c`

Database fingerprint:

`1|1|1|1|20261006_0004`

Production final smoke verified:

- frontend healthy;
- backend healthy;
- Postgres healthy;
- exact accepted frontend image;
- exact accepted backend image;
- exact Nginx configuration;
- exact Python Worker;
- `worker-src 'self'`;
- no legacy backend Python execution route;
- frontend-to-backend readiness connectivity;
- database unchanged.

## Browser Python security position

The V1 Python architecture remains:

- browser-side execution only for notebook Python;
- dedicated Web Worker;
- self-hosted Pyodide 314.0.7;
- pandas 3.0.2;
- 50,000-character Python code limit;
- 10,000-row dataset limit;
- 10 MiB UTF-8 dataset-transfer limit;
- 90-second initialization timeout;
- 30-second dataset preparation timeout;
- 10-second execution timeout;
- bounded output/error transport;
- fatal resource-exhaustion Worker reset;
- normal Worker persistence to preserve notebook state;
- no hard total-browser memory ceiling claimed.

The Worker is defense in depth and responsiveness isolation, not an operating-system sandbox for hostile code.

## Final deployment flags

`FRONTEND_8G6_DEPLOYED=True`  
`BACKEND_8G2_DEPLOYED=True`  
`BACKEND_8G6_DEPLOYED=True`

Caddy was unchanged.

Database schema and persisted application data were unchanged.

## Exact source delta from Phase 8G.5

Modified:

1. `frontend/nginx.prod.conf`

Added:

2. `docs/phases/phase8G6/PHASE8G6_COMPLETION.md`

No other source change belongs to Phase 8G.6.