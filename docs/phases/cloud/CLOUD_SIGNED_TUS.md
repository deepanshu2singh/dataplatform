# Signed resumable upload endpoint correction

## Evidence and scope

Input: the complete 232-file prepared readiness checkpoint, SHA-256
664ea6133e2faa7787ef575539c5bbcec51f344f5b5fec574dccd42afef74d6a.
ZIP CRC, every source-manifest hash and the matching prepared working tree were
verified before an isolated candidate was created. Windows apply guards verify
the real checkout; this prepared snapshot is not a new Windows capture.

The user's browser at https://dataplatform.sprout-sql.com/datasets attempted
sales-smoke.csv (177 bytes). Supabase's direct Storage endpoint returned HTTP 400
with body statusCode=403, code=AccessDenied, error=Unauthorized and
message=Invalid Compact JWS. This is a Storage request failure, distinct from
the earlier hosted database InvalidPasswordError/28P01. Account creation/login
were reported successful later; current database readiness is still unverified.

The adapter returned /storage/v1/upload/resumable, while the browser supplied an
object-scoped signed upload token in x-signature. Supabase's maintained signed
example uses /storage/v1/upload/resumable/sign. A Storage maintainer identifies
this exact distinction for Invalid Compact JWS. The documentation clarification
PR remains open; do not describe it as merged or treat the regular bearer-token
example as the signed-upload contract.

Primary references inspected:
- https://github.com/supabase/supabase/blob/master/examples/storage/resumable-upload-signed-uppy/index.html
- https://github.com/supabase/storage/issues/1268
  (See the maintainer's 31 August 2026 comment.)
- https://github.com/supabase/supabase/pull/49760

One runtime file changes: backend/app/services/storage.py. Both hostname branches
now return the signed route. Token creation, x-signature forwarding, owner-scoped
paths, private bucket, 6 MiB chunks, expiry, completion/replay and cleanup remain
the existing implementation. Three existing test files are updated; two phase
documents are added. There is no dependency, migration, environment or credential
change in this patch.

## Validation completed here

- Backend Python 3.12: 44 passed, 1 existing Pydantic deprecation warning in 1.36s.
  Files: test_storage_service.py, test_cloud_storage_extensions.py,
  test_cloud_dataset_flow.py. Tests cover the signed route for hosted/custom
  origins, token/secret separation, prepare-result forwarding, private download
  guards, ownership, replay and temporary-file cleanup.
- Browser upload: 5 passed in datasetUpload.test.ts. The browser uses the returned
  /sign endpoint, sends the signed token only in x-signature, and preserves
  transfer/completion retry behavior. These are mocked behavior checks.
- No live Supabase credentials or signed tokens were received, decoded or stored.
  No live upload was performed here. User-side live acceptance remains required.
- Initial backend test launch lacked pytest in the reduced runtime. The existing
  test-only overlay supplied pytest; no application dependency was changed.
- Windows PowerShell execution is unavailable locally. Package guard, exact-byte
  application, idempotence, later-edit rejection and rollback are simulated in
  Python. Windows verification is a separate acceptance gate.

## Windows apply and focused checks

1. Download DataPlatform_Cloud_Signed_TUS_Patch.zip. Run the checksum-checked
   selector supplied in chat; it extracts into a fresh folder, checks current
   branch/HEAD/source prerequisites, then applies only the six listed files.
2. Keep the printed checkpoints/cloud-signed-tus-rollback-* folder. It contains
   exact touched-file originals and ROLLBACK-CLOUD-SIGNED-TUS.ps1. A mismatch
   stops without changing application source. The CLI's .gitignore addition is
   preserved and not a prerequisite.
3. With Docker Desktop running, open PowerShell at the project root and run:

```powershell
Set-Location "D:\New project\databricks-clone-v1"
docker compose -f .\docker-compose.test.yml run --build --rm --no-deps backend-tests python -m pytest -q tests/test_storage_service.py tests/test_cloud_storage_extensions.py tests/test_cloud_dataset_flow.py
```

Expected: 44 passed. This starts no test database/API dependency and runs no
Supabase migrations. If it fails, share the failure and stop before deployment.

4. After that passes, run:

```powershell
npm.cmd --prefix .\frontend test -- src/lib/datasetUpload.test.ts
```

Expected: 5 passed. Existing installed dependencies are used; no forced audit
fix or package upgrade is part of this phase. Share both summaries.

## Hosted/browser acceptance after Windows checks pass

Deploy the linked project from its root:

```powershell
npx.cmd --yes vercel@63.1.2 deploy --prod --scope deepanshu1927
```

Record the NEW deployment URL. Use pinned vercel curl on that exact deployment
for /health/live and /health/ready. Startup requires 200; readiness requires 200
with database and migrations both ok. A previous successful browser registration
does not substitute for this fresh readiness gate. If readiness remains 503,
read the current safe diagnostics, not old deployment logs.

For the user's custom-domain browser, reload after deployment (Ctrl+Shift+R),
then open a NEW upload dialog and reselect sales-smoke.csv. The old open dialog
retains its prepared intent and old endpoint; Retry there would reuse the old
route. A new preparation generates a new owner-scoped object key and signed
capability. Do not manually edit tokens, delete Storage objects, make the bucket
public, disable authorization or enable upsert to bypass this error.

In Developer Tools Network, expect preparation 201, initial POST to
/storage/v1/upload/resumable/sign 201, successful subsequent TUS transfer and
backend completion 201. The dataset must appear, preview correctly, and survive
a page reload. Do not share Request Headers, signed tokens, full capability URLs
or raw HAR files. If anything fails, share only status and safe Response text.

After this small-file gate, the existing broader live acceptance remains:
larger CSV direct upload/retry, restricted SQL, widget, bounded self-hosted browser
Python, two-account ownership, deletion, and actual public-schema RLS/Data API
exposure review. Do not mark the entire project complete after this patch alone.

## Rollback

Use the actual printed backup folder. Invoke its rollback with explicit
BackupRoot, first VerifyOnly, then apply. It verifies originals and refuses to
overwrite edits made after this patch. It restores only phase files, removes
phase-added docs, and does not reverse migrations or change cloud data/secrets.
If the corrected source was deployed, restoring local source alone does not
change the hosted deployment; deploy the reviewed restored source separately.
