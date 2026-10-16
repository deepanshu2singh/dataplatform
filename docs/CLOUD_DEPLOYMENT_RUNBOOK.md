# DataPlatform cloud deployment readiness

11 October 2026. Prepared from the verified Windows checkpoint; live host acceptance pending.

Current operational state, 12 October 2026 ~21:26 Europe/London: project linked
on Hobby; current Production deployment np6y830mt is Ready and hosted liveness
is 200. SECRET_KEY and asynchronous DB driver startup failures were corrected
through private Vercel settings. Supabase public schema was confirmed empty,
then all five shipped migrations applied; live alembic current verified
20261011_0005 (head). Post-migration hosted readiness still returned 503. A focused
eight-file readiness diagnostics patch is now prepared and locally verified with
40 passing tests; apply/check it using CLOUD_READINESS_RUNBOOK.md before another
hosted readiness probe. Keep Deployment Protection enabled. Historical
setup steps below are not instructions to repeat already accepted work.

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
| Existing Vercel project | deepanshu1927/dataplatform-v1; created and linked |
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

## Step 3 — configure Preview server values privately

The actual linked project is deepanshu1927/dataplatform-v1, ID
prj_aPRz0LtzuGbMYGMmy7BPqlSdoCco. Inspection confirmed repository root `.`,
Node.js 24.x and Services preset. User confirmed assigned production domain
`dataplatform-v1.vercel.app`. Hobby was confirmed in the supplied dashboard screenshot.
The inspect output's Sandbox region iad1 is not an observed API function region;
the source requests lhr1 for the backend function and actual deployment must verify it.

In the project dashboard, open Environment Variables. Select Preview for this
first acceptance phase and all Preview branches. Use Config for public settings
and Secret for the three credential variables. Save each value. Production
configuration/promotion follows accepted Preview and database/browser checks.

| Variable | Type | Value/source |
|---|---|---|
| ENVIRONMENT | Config | production (secure behavior also during Preview) |
| DATABASE_USE_NULL_POOL | Config | true |
| AUTH_COOKIE_SECURE | Config | true |
| AUTH_COOKIE_SAMESITE | Config | lax |
| AUTH_COOKIE_PATH | Config | /api/v1 |
| FRONTEND_URL | Config | https://dataplatform-v1.vercel.app |
| STORAGE_BACKEND | Config | supabase |
| SUPABASE_URL | Config | https://ckjkgsojwtzbiyqxbtdx.supabase.co |
| SUPABASE_STORAGE_BUCKET | Config | datasets |
| UPLOAD_DIR | Config | /tmp/dataplatform-uploads |
| MAX_UPLOAD_SIZE | Config | 50000000 |
| SQL_ECHO | Config | false |
| LOG_LEVEL | Config | INFO |
| VITE_API_URL | Config | /api/v1 |
| DATABASE_URL | Secret | Actual Supabase session pooler URL on port 5432, with postgresql+asyncpg scheme, percent-encoded password and ssl=require |
| SUPABASE_SECRET_KEY | Secret | The server secret key already used for earlier successful Storage smoke, or sb_secret key from Supabase Settings / API Keys |
| SECRET_KEY | Secret | Stable high-entropy production JWT signing key; never use development/test markers |

Supabase Connect / Session pooler supplies the actual username and hostname;
copy them rather than composing a host from the region. Transform the URI prefix
from postgresql:// to postgresql+asyncpg://. Encode reserved characters in the
password only and use the asyncpg URL parameter `?ssl=require`, not the libpq
parameter sslmode. SQLAlchemy 2.0.25's asyncpg dialect was checked locally to
forward `ssl=require` correctly; no live DB connection was made by that check.
The existing adapter sends the server key on `apikey`, supporting sb_secret keys.
No Supabase publishable/anonymous key belongs in SUPABASE_SECRET_KEY.

A production JWT key can be generated on the user's own Windows computer and
copied to the clipboard without printing it:

```powershell
& {
    $keyBytes = New-Object byte[] 64
    $crypto = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $crypto.GetBytes($keyBytes) }
    finally { $crypto.Dispose() }
    Set-Clipboard -Value (([BitConverter]::ToString($keyBytes)).Replace("-", "").ToLowerInvariant())
    Write-Host "SECRET_KEY copied. Paste it into the Vercel Secret field."
}
```

Retain the same key after it is saved. Credentials are entered only on the
user's machine/dashboard and never copied into the chat, source or Library.
Do not prefix credentials with VITE_. Actual env and .vercel files stay excluded.

After saving, list only variable metadata in normal text output:

```powershell
Set-Location "D:\New project\databricks-clone-v1"
npx.cmd --yes vercel@63.1.2 env ls preview --scope deepanshu1927
```

Do not use JSON output: the CLI documents that JSON may include readable Config
values. Send the normal listing and confirm the workspace Plan is Hobby.
Environment presence checks are not proof the credential values are valid.

## Step 4 — actual host build and schema gates

Correction to the earlier runbook: Vercel Secret values are write-only, and the
installed CLI 63.1.2 explicitly warns that Preview/Production Secrets cannot be
pulled. A local build after `vercel pull` must not be assumed to receive them.
Keep the credentials classified Secret and use a Vercel-hosted Preview build.
The local cloud build and clean runtime gates have already passed.

Once variable metadata and Hobby plan are confirmed, use the linked repository
root for a remote build/deployment:

```powershell
npx.cmd --yes vercel@63.1.2 deploy --scope deepanshu1927
```

Important: Vercel always assigns a new project's first deployment to Production,
even without --prod. The user's first deployment was assigned to Production and
reported Ready on 12 October; Deployment Protection remains enabled. Subsequent
deployments without --prod default to Preview. Do not repeat this command merely
to obtain a Preview URL; first inspect and validate the existing protected deployment.
Actual Vercel build must accept
both services, package the Python runtime below the standard 500 MB uncompressed
limit, retain alembic.ini/migration scripts and serve the Python assets as static
files. Do not upload full .vercel function/env output for inspection. Share build
summary/errors and the actual Preview URL; no credential values are needed.
If the remote build fails, stop and diagnose it before changing plans/configuration.
The app is not accepted merely because a deployment URL exists.

Current protected deployment: dataplatform-v1-np6y830mt-deepanshu1927.vercel.app.
Read the build logs using inspect --logs, then use vercel curl /health/live and
/health/ready with explicit --deployment and --scope deepanshu1927. Pass curl
flags after --. Keep Deployment Protection enabled and share status/body without
request authentication headers, cookies or credentials. Readiness is read-only.

Inspect actual Supabase schema before any migration. Upgrade to 20261011_0005
is a separate deliberate operation using the correct server connection, never
an import/build/startup side effect. No downgrade/reset is part of this plan.
Do not exercise dataset writes on a mismatched database schema. Readiness and
browser acceptance must pass before declaring the protected deployment accepted
or changing public access. Production assignment alone is not project acceptance.

This schema gate was completed on 12 October: no public tables and no Alembic
tracking table existed, then upgrade through 20261011_0005 succeeded and current
revision was independently read back. Do not repeat migrations. Recheck hosted
/health/ready against the current deployment; the database change does not require
a source rebuild. Previous local connection probe took 2.16 seconds versus the
current 2-second readiness timeout; timeout contribution is not yet proven.

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

Environment setup revision: 12 October 2026. Package ZIPs retain the earlier
prepared runbook as historical source; use this updated standalone runbook for
Secret handling and the actual host build. No application source changed.

First-host revision: 12 October 2026. First-deployment Production exception
corrected after actual CLI output; protected deployment inspection is next.
