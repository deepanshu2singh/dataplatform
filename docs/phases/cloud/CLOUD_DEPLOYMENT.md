# DataPlatform cloud deployment readiness

11 October 2026. Prepared from the verified Windows checkpoint; live host acceptance pending.

## Goal and current result

Keep the existing CSV/SQL/notebook/dashboard V1 and deploy it on Vercel Hobby
with the existing Supabase Free project. Backend and frontend share one domain.
Python remains in the browser; original CSV and bounded snapshots stay in
private Supabase Storage. There is no paid feature or new background service.

The deployment patch is prepared and locally validated. It has not created a
Vercel project, migrated Supabase, published the app or changed Git history.
Vercel Services currently remains Beta; passing local checks is not host acceptance.

## Actual public settings

| Setting | Value |
|---|---|
| Supabase API origin | https://ckjkgsojwtzbiyqxbtdx.supabase.co |
| Direct storage origin | https://ckjkgsojwtzbiyqxbtdx.storage.supabase.co |
| Supabase region | User reported West Europe / London |
| Backend Vercel region | lhr1 / London |
| Bucket | datasets; user reported Private and 50 MB limit |
| Application upload cap | 50,000,000 bytes; conservatively below either common interpretation of 50 MB |
| Existing Vercel project | None; user reported |
| Vercel project Root Directory | Repository root, `.`; services define backend/frontend roots |

The frontend may display this byte cap using binary units (approximately
47.7 MiB). It is deliberately not the earlier 52,428,800-byte example cap.

## Changes and wiring

- `vercel.json`: frontend Vite service, backend FastAPI `app.main:app` service
  rooted at `backend`; original `/api/*` and `/health/*` paths are preserved.
  The frontend serves existing static assets first, returns 404 for missing
  assets/runtime files, and then supplies the SPA for application navigation.
- Cloud CSP permits the two exact project origins above, self-hosted scripts,
  WASM and workers; it has no wildcard Supabase host allowance. Cookie/API
  behavior and CSRF implementation are unchanged.
- Backend function maximum duration is 300 seconds in lhr1. Runtime packaging
  retains app modules, alembic.ini and migration scripts; frontend runtime
  assets belong to the frontend service. Runtime checks/scripts/tests and
  private local files are excluded from the backend function.
- `.vercelignore` excludes local secrets/data/archives/caches and preserves
  the required browser `python_stdlib.zip` exception.
- `backend/.python-version` pins 3.12. Three unused runtime dependencies
  (`pyarrow`, `openpyxl`, `xlrd`) were removed; actual CSV/SQL/snapshot behavior
  was checked in an environment where all three are absent. This V1 is CSV-only.
- `frontend/scripts/build-vercel.mjs` sets `/api/v1` for the cloud build without
  editing local frontend env files. A conflicting hosting VITE_API_URL fails
  before building. It validates the actual main bundle and shipped Python assets.
- `backend/scripts/verify_deployment_runtime.py` is a local check without DB
  or Storage connections; it runs inside the newly rebuilt Docker runtime.
- `backend/.env.cloud.example` records actual public origins/bucket and the
  conservative cap. Credential placeholders remain explicit and must be filled
  only in server settings; it is not an operational env file.
- The checkpoint capture script now omits generated coverage. It still captures
  root Vercel configuration and the new phase evidence.

## Acceptance already performed here

- Clean Linux Python 3.12 runtime: 49 distributions, 313,506,018 dependency bytes
  (298.98 MiB). This is a local installed-file measurement, not a Vercel bundle.
- App import includes shipped Alembic head 20261011_0005. Actual CSV inference,
  DuckDB aggregation, SQL-write rejection, snapshot/hash, health, unauthenticated
  access and untrusted-origin CSRF checks passed without the three removed packages.
- Focused backend cloud flow, SQL restrictions, offline DDL and response guard:
  **35 passed, 2 existing deprecation warnings**. No PostgreSQL instance was used
  for these phase checks; the prior 175-pass user Docker gate remains baseline evidence.
- Cloud TypeScript/Vite build passed; `/api/v1` appears in the application bundle,
  localhost API is absent, and all essential worker/Pyodide assets ship. Existing
  large chunk warnings remain. A conflicting API override fails before build.
- Vercel's current schema field constraints and routing-utils 6.6.0 passed
  local configuration/routing checks, including original API paths, SPA refresh,
  missing static 404 and JS/WASM types. The published schema mixes dialect
  metadata; its draft-04 label was omitted for modern Ajv field validation while
  retaining all constraints. This is not a Vercel deployment acceptance result.
- Vercel CLI 63.1.2 was checked. Its actual build correctly stops because no
  linked project settings exist yet. No account authentication was attempted.

## Step 1 — apply and check on Windows

Download DataPlatform_Cloud_Deployment_Patch.zip and use the checksum-checked
ZIP selector supplied in the chat. It extracts to a unique temporary directory,
verifies the source prerequisites, then applies only the declared phase files.
It saves exact changed-file originals under a printed checkpoints rollback folder.

From `D:\New project\databricks-clone-v1`, run:

```powershell
node .\frontend\scripts\build-vercel.mjs
if ($LASTEXITCODE -ne 0) { throw "Cloud frontend build failed; share its error." }

docker compose -f .\docker-compose.test.yml run --build --rm --no-deps backend-tests python -m scripts.verify_deployment_runtime
if ($LASTEXITCODE -ne 0) { throw "Deployment runtime check failed; share its error." }
```

The second command rebuilds the test image with the reduced dependencies.
It does not start PostgreSQL, run migrations or call Supabase. Expected final
results: CLOUD_FRONTEND_BUILD=PASS, CLOUD_API_BASE=/api/v1,
SELF_HOSTED_PYTHON_ASSETS=PASS and JSON with DEPLOYMENT_RUNTIME=PASS.
Stop on a failure and diagnose it before taking the next step; do not repeatedly
rerun broad suites. Prior frontend 104-pass and full Docker 175-pass evidence
is retained; no app TypeScript/Python route implementation changed in this phase.

## Step 2 — create/link the free Vercel project

Only after Step 1 passes, use your personal Hobby account. Current CLI version
used for this phase is pinned below; this installs a tool, not an app dependency.
From the repository root:

```powershell
npx --yes vercel@63.1.2 login
npx --yes vercel@63.1.2 link
```

Choose your personal Hobby scope, a new project (suggested name dataplatform-v1),
and directory `.`. Do not choose `frontend` as the overall project root: both
services must be built. Keep automatic deployments off while server settings and
the build gate are incomplete. Linking writes local .vercel metadata; it does
not itself publish the application. No Git commit/push is needed for linking.
If the wizard presents conflicting monorepo/framework or paid-plan choices,
share the prompt before making a different architecture choice.

In project settings, verify Root Directory `.` and Node.js 24.x. Obtain the
actual assigned production domain from the project's Domains settings; do not
guess a public hostname from the suggested project name. Keep Fluid Compute on
for the documented Hobby duration. Services settings are owned by vercel.json.

## Step 3 — configure server values privately

Use the Vercel project's environment settings. Before building, set values for
the environment being tested (Preview or Production). Do not upload raw env files.

| Variable | Value/source |
|---|---|
| ENVIRONMENT | production, including preview acceptance |
| DATABASE_URL | Actual Supabase **session pooler** asyncpg URL, port 5432; copy from Connect and percent-encode the password as needed; keep it private |
| DATABASE_USE_NULL_POOL | true |
| SECRET_KEY | Your stable, private high-entropy app JWT secret; never a placeholder |
| AUTH_COOKIE_SECURE | true |
| AUTH_COOKIE_SAMESITE | lax |
| AUTH_COOKIE_PATH | /api/v1 |
| FRONTEND_URL | Actual HTTPS production origin, with no path |
| STORAGE_BACKEND | supabase |
| SUPABASE_URL | https://ckjkgsojwtzbiyqxbtdx.supabase.co |
| SUPABASE_SECRET_KEY | Actual server-only secret/service-role key, kept private |
| SUPABASE_STORAGE_BUCKET | datasets |
| UPLOAD_DIR | /tmp/dataplatform-uploads |
| MAX_UPLOAD_SIZE | 50000000 |
| SQL_ECHO | false |
| LOG_LEVEL | INFO |
| VITE_API_URL | /api/v1, or omit because the cloud build wrapper supplies it |

Never prefix a secret with VITE_. Vite exposes only explicitly referenced
VITE-prefixed values in client bundles; Supabase and database credentials are
server values. Do not use Supabase anonymous keys as the server Storage secret.
Do not use transaction pooler port 6543 for this phase without a separate
prepared-statement review. Earlier connection/token smoke checks do not replace
checking the actual host's environment.

## Step 4 — actual host build gate

Pull the selected environment and build it before publishing:

```powershell
npx --yes vercel@63.1.2 pull --environment=preview
npx --yes vercel@63.1.2 build --standalone
```

Pulled private values stay in excluded .vercel files. Do not share those files
or the full function output archive. Share the redacted build summary/error
and function size. Verify the actual Python bundle is below the standard 500 MB
uncompressed limit, entrypoint is app/main.py, Alembic files are present, both
services build and the browser runtime assets are static. If CLI Services build
is unsupported or fails, diagnose it before attempting deployment or changing
plans. Local schema checks do not authorize claiming this gate passed.

Actual Supabase revision must be inspected before any migration. Upgrade to
20261011_0005 is a separate deliberate operation using the correct server
connection, never a deployment build/import/startup side effect. No downgrade
or database reset is part of this plan. Once build and schema gates are accepted,
publish a Preview first using the matching environment and test it before Production.

## Step 5 — deployed browser acceptance and checkpoint

Use the actual public HTTPS origin. Verify liveness/readiness and API unknown
path responses; log in, reload, create a small CSV dataset, run SQL, render a
dashboard widget and load it into browser Python. Verify session cookies remain
HttpOnly/Secure and unsafe requests from another origin fail. Check browser
console/network for CSP/CORS, verify both Storage origins and runtime MIME types,
then test a CSV larger than 4.5 MB to demonstrate direct TUS transfer.

Check completion retry does not duplicate metadata, owner isolation, deletion
of source/snapshot and Python size/hash constraints. Cloud response guards
remain active. Cold start/resource behavior needs actual Hobby measurements.

Record these live results before declaring deployment complete. Run the current
project checkpoint script after the accepted phase; it now skips coverage,
includes vercel.json and phase evidence, and excludes private .vercel settings.
The prepared clean full source checkpoint supplied with this patch is a local
reference; it is not proof that the patch has been applied on Windows.

## Scoped rollback

Use the printed rollback folder's ROLLBACK-CLOUD-DEPLOYMENT.ps1 -VerifyOnly
before restoration. The rollback refuses later edits and restores only files
changed by this package. It changes no database, bucket, object or Git history.
Do not delete the Supabase bucket or downgrade the database as rollback.
After cloud records exist, keep cloud-aware dataset readers; use a compatible
previous deployment rather than reverting to local-only storage code.

## References

- https://vercel.com/docs/services
- https://vercel.com/docs/services/config-reference
- https://vercel.com/docs/services/routing
- https://vercel.com/docs/functions/runtimes/python
- https://vercel.com/docs/functions/limitations
- https://vercel.com/docs/cli/link
- https://vercel.com/docs/cli/build
- https://supabase.com/docs/guides/storage/uploads/file-limits
