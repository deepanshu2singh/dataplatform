# Cloud dataset integration: apply and verification

Date: 11 October 2026. Source implementation prepared; live acceptance pending.
This phase does not provision services, deploy, or modify your cloud account.

## Apply to the existing checkout

Extract `DataPlatform_Cloud_Dataset_Patch.zip` into a separate folder, outside
your checkout. Keep the scripts, changeset and `patch` directory together.
In PowerShell, run from that extracted folder:

```powershell
& .\APPLY-CLOUD-DATASET-INTEGRATION.ps1 -ProjectRoot "D:\New project\databricks-clone-v1" -VerifyOnly
& .\APPLY-CLOUD-DATASET-INTEGRATION.ps1 -ProjectRoot "D:\New project\databricks-clone-v1"
```

The script checks the branch, input hashes for every modified file and output
hashes for all patch files before replacement. It refuses conflicting local
edits and creates a scoped rollback folder under `checkpoints`. Already-applied
files are skipped. Existing credentials and unrelated working-tree changes are
preserved. The package also contains a reconstructed input checkpoint and a
complete updated source checkpoint as separate reference downloads.

PowerShell was reviewed but could not be executed in this Linux environment.
`-VerifyOnly` is the first Windows acceptance step. If a hash check fails, retain
the error and fresh Git status; reconcile that exact file before applying.

## Run the existing isolated Docker test stack

From your existing checkout, use the test Compose file. Its PostgreSQL database
and upload volume are separate from your development/production data:

```powershell
Set-Location "D:\New project\databricks-clone-v1"
git branch --show-current
git rev-parse HEAD
git status --short
docker compose -f .\docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from backend-tests
```

This runs the complete backend suite on Python 3.11 and PostgreSQL 15, including
the new migration and two competing-worker checks. Preserve the final pytest
summary and any traceback. An existing failed test container may need the test
stack stopped/recreated with this same Compose file; do not reset your main
database or delete the test volume preemptively.

Then verify the frontend:

```powershell
Set-Location "D:\New project\databricks-clone-v1\frontend"
npm ci
npm test
npm run lint
npm run build
```

Do not mark this phase accepted until the Docker run passes. The included
validation record distinguishes checks run here from these remaining checks.

## Cloud settings and the next deployment phase

Use `backend/.env.cloud.example` as a names-only template. Keep storage/database
credentials server-side. The PostgreSQL URL must use your actual session-pooler
host/user and percent-encoded password; `DATABASE_USE_NULL_POOL=true` avoids a
persistent app connection pool per serverless instance. Use a writable
`UPLOAD_DIR=/tmp/dataplatform-uploads`.

The application cap is **50 MiB = 52,428,800 bytes**. Confirm the private
`datasets` bucket's configured file limit agrees with that exact value; a
dashboard label saying “50 MB” is insufficient evidence of its byte boundary.
If the bucket is configured lower, set `MAX_UPLOAD_SIZE` to that actual lower
byte value. Source CSV uploads use signed TUS and immutable owner-scoped keys;
the browser never receives the server storage secret.

Before any deployment, inspect actual Vercel routing, Python bundle size,
function timeout/memory, writable paths, and all self-hosted Pyodide/Monaco
assets. None of those deployment files or live settings has been fabricated.
The preferred authentication topology is a frontend same-origin `/api` proxy,
with production Secure cookies, the exact frontend origin and existing CSRF
checks. Cross-site cookies would require a deliberate separate configuration.

The existing Docker CSP permits same-origin connections. The cloud frontend
must additionally permit **only your project's exact** Supabase Storage origins
in `connect-src`: the API origin used for signed downloads, and the direct
storage origin used for TUS. Retain the existing self-hosted script, Worker and
WebAssembly restrictions. Browser TUS also needs Storage CORS to allow its
protocol headers and expose upload-location/offset headers. Validate this in an
actual browser; a server-side token smoke check cannot establish it.

After the test gate and deployment setup are verified, migrate deliberately
using the server environment: `alembic upgrade head`. The intended new revision
is `20261011_0005`; readiness dynamically expects that shipped head. Never run
the migration on Supabase just to fix a local test failure.

## Live acceptance checklist

1. Login/logout, CSRF, secure cookie behavior and readiness pass on the actual
   deployed frontend/API URLs. Confirm no backend storage secret in the bundle.
2. Prepare and upload a CSV in the browser. Inspect TUS bytes going directly to
   Storage, then complete once; retry a lost completion response and confirm
   one dataset row. Check transfer interruption/resume and discard behavior.
3. Validate list, schema, SQL, preview, dashboard widget preview and saved widget
   data against the same private object. Foreign-account requests return 404.
4. Browser Python downloads the signed bounded snapshot, verifies its hash and
   loads at most 10,000 rows / 10 MiB. Validate an expired signed URL by retrying
   the authenticated export endpoint. The snapshot stays private.
5. Reject invalid/empty/oversized/incomplete CSVs. Check exact bucket/app byte
   limits and responses near the host's body limit; SQL row limits alone do not
   constrain very large cells. Cloud API responses have a 3 MiB guard.
6. Delete a dataset and check metadata removal and both object removals. Confirm
   database failure preserves source objects, and reader cancellation leaves no
   temporary files. Record observed runtime/bundle/resource limits.

## Maintenance and rollback

Pending/cancelled uploads may still possess a valid signed token. After its
two-hour lifetime plus a five-minute grace period, this explicit backend command
reclaims eligible unreferenced source/snapshot objects:

```text
python -m scripts.cleanup_cloud_uploads --limit 100
```

It selects locked expired intents, skips live dataset references and only uses
the currently configured bucket. No recurring cleanup job has been installed.
Run maintenance deliberately with the server environment after validating the
selection behavior. Failed post-delete cleanup can be reclaimed through the
completed intent whose dataset reference became NULL.

For source rollback before live cloud datasets exist, use the rollback script
in the backup directory printed by the apply script:

```powershell
& "D:\New project\databricks-clone-v1\checkpoints\PRINTED_BACKUP_FOLDER\ROLLBACK-CLOUD-DATASET-INTEGRATION.ps1" -VerifyOnly
& "D:\New project\databricks-clone-v1\checkpoints\PRINTED_BACKUP_FOLDER\ROLLBACK-CLOUD-DATASET-INTEGRATION.ps1"
```

It refuses later edits and restores only this patch's affected files. It does
not reset Git, touch credentials, downgrade a database or delete cloud objects.
The additive migration may remain. Once cloud datasets exist, reverting to the
old local-only routes requires a separate data-preserving transition.

## Source provenance

- Frozen V1 ZIP SHA-256: `7d1b1f85aba0c49de39d7699fd6156c3475b74e908b0c2b116ddf841efd0a530`.
- Current cloud ZIP SHA-256: `abd4c1885a9aecfb91bb8973eff99dc34b7238c2fb69ccd24affa3ea935fbfb2`.
- Current storage ZIP SHA-256: `161d2a156dd6e24c2ac0997b2c6e2902c99015a2485a257160c188eb16e1aa76`.
- Reported branch/HEAD: `cloud-deploy-v1`, `2443908c1a04a880fa92cd084ac260da3734f12d`.
- The seven cloud files and three storage files were mapped back to exact
  project paths. Dataset/dashboard extracts matched the frozen source.
- `INPUT_SOURCE_SHA256.json` records the 206 reconstructed input files.
  Full checkpoint manifests include file hashes; private data, credential env
  files, caches, build output and dependency directories are excluded.

Official references checked on 11 October 2026:
- https://vercel.com/docs/functions/limitations
- https://supabase.com/docs/guides/storage/uploads/resumable-uploads
- https://supabase.com/docs/reference/javascript/file-buckets-createsigneduploadurl
- https://supabase.com/docs/reference/javascript/file-buckets-createsignedurl
