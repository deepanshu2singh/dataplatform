# DataPlatform cloud deployment scope

11 October 2026 — checkpoint audit completed; implementation awaits public connection settings.

## Verified starting point

Input: `cloud-dataset-validated-20261011-134755-8e2419c9.zip`.
SHA-256: `9bc78b91e8abba7e91dc01172adaabd714b0a5b43cd3308a892af33a08302f55`.
ZIP CRC and all 252 manifested file hashes match. Windows ZIP entry separators
were normalized for inspection. No application source was modified during this audit.

Git evidence inside the capture: branch `cloud-deploy-v1`, HEAD
`2443908c1a04a880fa92cd084ac260da3734f12d`; integration changes remain uncommitted.
The application Python/TypeScript and dependency files match the prepared cloud
integration. Changes relative to that snapshot are .gitignore additions and
Nginx line endings. Additional files mainly comprise coverage output, the
capture script and verification record. Four root historical/sample files are
outside the capture selection; this is not evidence that they were deleted.
The 252 entries include generated evidence; they are not 252 application-source files.

Accepted validation: backend 175 passed / 2 warnings (user-reported Docker
summary); frontend 104 passed / 20 files, lint 0 errors / 9 warnings, successful
build (uploaded output inspected). These gates need not be repeated before edits.
Earlier live Supabase connection, signed-token and TUS endpoint smoke results
are historical evidence. They do not establish deployed browser acceptance.

## Cross-component findings

| Dependency | Actual wiring | Deployment implication |
|---|---|---|
| Frontend API | `frontend/src/lib/api.ts` uses VITE_API_URL or localhost:8000/api/v1; supplied frontend env summary also says localhost | Cloud build must deliberately use `/api/v1` |
| Frontend navigation | BrowserRouter with login, datasets, notebooks, dashboards and settings paths | Serve static assets first and supply SPA fallback for application routes |
| API entry | `backend/app/main.py` exports FastAPI `app`; imports use `app.*` | Backend service root must be `backend`, with entrypoint `app.main:app` |
| Authentication | HttpOnly cookie, path `/api/v1`; production HTTPS/Secure validation | Frontend and API should share one public origin; preserve paths |
| CSRF | Unsafe API requests require trusted Origin, which includes configured frontend origin | Set actual HTTPS FRONTEND_URL and verify same-origin POST behavior |
| Storage upload | Signed receipt from API; browser TUS goes to `<project>.storage.supabase.co` | Exact project storage origin belongs in cloud CSP connect-src |
| Python bridge | API receipt followed by signed download on Supabase project API host; bounded, hash-checked snapshot | Exact project API origin also belongs in connect-src |
| Local CSP | Nginx currently sets connect-src 'self' | Existing local configuration is not sufficient for a cloud-mode production browser |
| Browser Python | Self-hosted worker and Pyodide 314.0.7 assets | Serve worker, .mjs, .wasm and stdlib ZIP as static assets, not SPA HTML |
| Database | SQLAlchemy asyncpg; optional NullPool already implemented | Configure actual Supabase connection privately and enable NullPool |
| Readiness | Loads shipped Alembic scripts and expects head 20261011_0005 | Bundle alembic.ini and all migrations; verify actual database head separately |
| Runtime writes | Dataset resolver uses UPLOAD_DIR for unique temporary CSVs | Set writable `/tmp/dataplatform-uploads`; do not use deployment source as storage |
| Hosting | No vercel.json, Vercel entry/config files or linked project state in capture | Determine existing Vercel project before linking or creating anything |

The captured safe settings do not include an actual Supabase project URL,
cloud database hostname, or Vercel application origin. This does not mean
credentials or connections do not exist elsewhere on the user's computer.

## Selected implementation direction

One Vercel Hobby deployment containing a Vite frontend service and a FastAPI
backend service, with `/api/*` and `/health/*` routed to the backend and the
remaining paths to the frontend. Current Vercel documentation supports Services
on all plans, but it is Beta. An actual build/routing gate is required before
calling this deployment accepted. Do not use the superseded experimentalServices
configuration or assume that locally generated JSON has been accepted by Vercel.

This keeps the public origin shared, preserves `/api/v1` cookie/API paths and
uses the existing application. Browser file bytes continue going directly to
private Supabase Storage; no paid storage, proxy or background worker is added.
Keep Free/Hobby plans and included usage. No payment-required feature or paid
upgrade is part of this phase.

## Planned files and boundaries

| File | Purpose |
|---|---|
| root `vercel.json` | Services, path-preserving routing, runtime limits, exact cloud CSP, security/cache headers, frontend SPA routing |
| root `.vercelignore` | Exclude secrets, uploads, archives, coverage, dependency caches and local build output; retain required Python runtime assets |
| `backend/.python-version` | Pin supported Python 3.12, already exercised in this session |
| `backend/requirements.txt` | Consider removing unused pyarrow/openpyxl/xlrd after confirming CSV execution with the reduced environment |
| `frontend/scripts/build-vercel.mjs` | Portable cloud build wrapper that deliberately sets the same-origin API base and rejects an incompatible cloud override |
| `docs/phases/cloud/CLOUD_DEPLOYMENT.md` | Actual environment variable mapping, acceptance evidence and rollback |

Application auth, dataset completion, ownership, SQL restrictions and Python
limits remain the accepted foundation. Dependency pruning is limited to packages
with no application imports and no supported CSV behavior relying on them.

Bundle evidence: the current test environment occupies approximately 476 MiB,
including testing packages and bytecode. Installed distribution files account
for approximately 127.43 MiB for pyarrow, 1.87 MiB for openpyxl and 0.70 MiB for
xlrd; no application import of these three was found. These are local
measurements, not Vercel artifact sizes. Measure the actual Python 3.12 runtime
bundle after building; do not claim it fits from this estimate.

## Acceptance gates

1. Exact public project URL, bucket privacy/size cap and Vercel project/root are known.
2. Guarded scoped patch verifies against the captured input and retains rollback originals.
3. A supported Vercel build accepts the Services configuration and Python entry;
   function bundle is below the standard 500 MB uncompressed limit. All Alembic
   scripts ship, and static Python assets stay outside the API function.
4. Build uses `/api/v1`. API/health unknown paths return API errors; application
   refreshes reach the SPA; missing runtime assets return 404 instead of HTML.
5. Production secrets exist only in server settings. Actual HTTPS frontend,
   private bucket, NullPool and writable temp storage settings are verified.
6. Database upgrade to 20261011_0005 is a separate deliberate operation, never
   an import/build/startup side effect. Readiness reports database and migrations OK.
7. Real browser login and reload preserve the HttpOnly Secure session; untrusted
   unsafe requests fail CSRF checks. No CSP/CORS failure on upload or snapshot download.
8. Real upload → completion/retry → preview → restricted SQL → dashboard widget
   → browser Python → deletion flow succeeds with ownership checks. Test with a
   small CSV and one larger-than-API-payload CSV to exercise direct transfer.
9. Record live results; create and verify the next clean full checkpoint.

Hobby currently documents 300-second maximum duration, 2 GB / 1 vCPU and
500 MB standard uncompressed Python bundles. Existing direct Storage transfer
and the cloud API response cap address the HTTP payload constraint. Runtime
limits still require actual host acceptance and do not guarantee workload speed.

## Rollback

Before cloud records exist, restore only changed files through a scoped,
hash-checked rollback, retaining later edits. Once cloud records exist, keep the
cloud-aware integration and use a compatible previous deployment. This phase
does not authorize database downgrade/reset, bucket removal or source-object
deletion as rollback. Do not revert to a local-only reader while cloud records exist.

## Required public inputs

- Supabase Project URL and project region, from Project Settings / API and project settings.
- Actual dataset bucket name, whether it is Private, and its configured maximum file size.
- Whether a Vercel project already exists for DataPlatform; if yes, its project
  name/public URL and Root Directory from Project Settings / Build and Deployment.

Passwords, connection strings with credentials, secret/service-role keys and
SECRET_KEY are not requested. Keep these in the user's server settings.

## Primary references checked on 11 October 2026

- https://vercel.com/docs/services — shared deployment; Services currently Beta on all plans.
- https://vercel.com/docs/services/config-reference — service root, framework, entrypoint and functions.
- https://vercel.com/docs/services/routing — original request paths preserved; no fallback to another service after selection.
- https://vercel.com/docs/functions/runtimes/python — Python 3.12–3.14; dependencies and explicit bundle exclusions.
- https://vercel.com/docs/functions/limitations — Hobby duration/memory and standard Python bundle limits.
- https://vercel.com/docs/services/pricing — normal Functions compute and included Hobby service requests.

Next step: receive the three public setting groups above, then create the scoped
deployment patch against this exact checkpoint. No migration, deployment, commit,
push or cloud cleanup has been performed by this audit.
