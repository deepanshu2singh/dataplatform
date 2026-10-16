# DataPlatform dashboard canvas — phase A

Prepared from your actual Windows checkpoint:
cloud-dashboard-baseline-20261015-020412-aecb5285.zip
SHA256 970b770bb664e8819393b09ba9e9abaf3bf2f3de1cfb9a63b9c608f373e1bdc6.
ZIP CRC and all 253 source hashes verified. Application code matches your deployed
visual design phase; only the latest verification metadata differs from its
prepared source. Existing branch cloud-deploy-v1 and HEAD
2443908c1a04a880fa92cd084ac260da3734f12d are retained.

## What this update does

- A 12-column canvas shared by the dashboard editor and read-only viewer.
- Drag the small top handle to move a widget; pull its bottom-right handle to
  resize it. Cards snap to the grid. Collisions push other cards down, preserving
  their IDs, queries and settings. Bounds prevent off-canvas or overlapping saves.
- On a handle, arrow keys move or resize one step; Shift moves two. Escape cancels
  a drag, including the provisional movement of other cards. Edit widget →
  Placement has exact Column, Row, Width and Height controls for keyboard/mobile.
- Duplicate, Lock/Unlock, Tidy layout and up to 50 draft undo/redo steps work.
  Lock controls placement, addition/deletion and duplication; content editing and
  data refresh remain available. Lock is saved with the dashboard. Undo/redo cover
  widget changes; dashboard name/description and lock toggles are outside history.
- Charts resize their plot, tables scroll within their resized card, and metrics
  adapt within theirs. Minimum width 3 columns, height 5 rows; maximum width 12,
  height 40. The finite grid has 1000 rows and the existing 40-widget limit.
- On screens below 768px, cards stack in saved widget order, with bounded display
  height. Desktop coordinates are retained. Dragging is disabled there; Placement
  controls still edit the desktop arrangement. Theme changes preserve drafts.
- Navy/teal dashboard surfaces and charts, cream light surfaces, amber/coral series
  accents. Existing Light/Dark/System preference and navigation remain connected.

## Saved data and compatibility

Layout version 1 used a flow layout and ignored x/y. It is converted to a draft
12-column arrangement in the same visual order, without writing on GET or view.
Only an explicit Save stores layout version 2 with integer grid coordinates.
The database's existing JSON column and existing optimistic version column are
used; no new database migration is needed or included. Owner checks, bounded
SQL queries, private storage, upload paths and notebooks retain their contracts.

The API now returns the dashboard row version. The editor sends expected_version
with updates, so an older tab cannot overwrite a newer draft. A stale save returns
409 while keeping your draft. Open the current dashboard in a separate tab to
compare before choosing what to keep. A cached old editor cannot downgrade a
saved version 2 dashboard back to version 1. The server validates grid bounds,
non-overlap, unique IDs and existing config/layout limits before storing anything.
Edits are disabled while Save is awaiting its response, preventing a late response
from erasing newly entered changes. Placement does not execute SQL or auto-save.
Editing/deleting a widget cancels its outstanding request so old results cannot
reappear. Undo/redo retain results for unchanged query/config pairs.

## Local checks and limits

Full frontend suite: 134 tests across 25 files passed. TypeScript and cloud wrapper
build passed; same-origin API /api/v1, patched editor sanitizer graph and immutable
self-hosted Python assets passed their existing build checks. Lint: 0 errors,
9 existing warnings. Existing large-chunk build warning retained. Frontend package
and lock files are byte-identical; no dependency install/update is required on
Windows if your previous dependencies are still present.

139 backend tests passed in a fresh isolated Python 3.12 runtime using the unchanged
pinned requirements. A preliminary broader run reached 27 PostgreSQL-dependent
migration/concurrency tests that failed because TEST_DATABASE_URL is unavailable
here (KeyError), not because a database rejected the canvas. Those 27 checks and
the integration API suite must run against Docker's disposable test PostgreSQL on
Windows. Added integration coverage exercises real create/read/update/version,
stale save and cached-client downgrade rejection. It has not run against a local
PostgreSQL server in this workspace. No Supabase migration/test/cleanup was run.

Production-build Chromium QA uses synthetic authenticated API fixtures and the
existing production CSP. Real pointer events, keyboard movement/resize, Escape,
collision handling, duplicate ID, undo/redo, locking, exact Save/reload/viewer
roundtrip, numeric table resizing, mobile stacking and 409 draft retention were
checked. The actual chart SVG changes width and height. Sampled HTML contrast
checks exclude SVG/editor tokens and are not a full accessibility audit. Live
Supabase/Vercel acceptance remains a separate check after Windows gates.

## Step 1 — apply the downloaded patch

Download DataPlatform_Cloud_Dashboard_Canvas_Patch.zip. Open the SAME PowerShell
window used for this project. Paste the checksum-verified apply block supplied in
chat. When it asks for the downloaded ZIP path, paste its full Windows path.
The script checks all affected and prerequisite files before writing and makes a
scoped original-file backup under checkpoints/cloud-dashboard-canvas-rollback-...
Keep that printed backup path. Application does not commit, migrate, deploy,
change credentials, or touch cloud resources. Stop and share any error.

## Step 2 — check the changed app on Windows

Open Docker Desktop and wait until it says the engine is running. In PowerShell
at D:\New project\databricks-clone-v1 run the guarded check block supplied in chat.
It first rebuilds the disposable backend test API, then runs the backend suite
against its test PostgreSQL, then frontend tests, lint and the cloud build.
The compose file explicitly targets postgres-test and test uploads, not Supabase.
Do not substitute production.env or a cloud DATABASE_URL into these tests.

```powershell
& {
    $ErrorActionPreference = "Stop"
    Set-Location "D:\New project\databricks-clone-v1"
    docker compose -f .\docker-compose.test.yml up -d --build backend-test-api
    if ($LASTEXITCODE -ne 0) { throw "Test services failed to start." }
    docker compose -f .\docker-compose.test.yml run --build --rm backend-tests
    if ($LASTEXITCODE -ne 0) { throw "Backend checks failed." }
    npm.cmd --prefix .\frontend test
    if ($LASTEXITCODE -ne 0) { throw "Frontend tests failed." }
    npm.cmd --prefix .\frontend run lint
    if ($LASTEXITCODE -ne 0) { throw "Frontend lint failed." }
    node.exe .\frontend\scripts\build-vercel.mjs
    if ($LASTEXITCODE -ne 0) { throw "Cloud frontend build failed." }
    Write-Output "WINDOWS_DASHBOARD_CANVAS_CHECKS=PASS"
}
```

Expected frontend 134 tests / 25 files; lint 0 errors / 9 existing warnings;
EDITOR_SANITIZER_BUNDLE=PASS, CLOUD_FRONTEND_BUILD=PASS,
CLOUD_API_BASE=/api/v1, SELF_HOSTED_PYTHON_ASSETS=PASS.
Send the final result. A failure stops the block; send that error before deploying.
Do not run npm audit fix or alter environment variables for this phase.

## Step 3 — deploy after the Windows checks pass

Use the existing project only:

```powershell
npx.cmd --yes vercel@63.1.2 deploy --prod --scope deepanshu1927
```

Copy the NEW exact hostname from its output. Check /health/live and /health/ready
with vercel curl against that hostname, using the same CLI/scope. Both must be
HTTP200. No environment variable, password, Supabase Data API or bucket change is
needed. At https://dataplatform.sprout-sql.com hard-refresh to load the new client.

## Step 4 — browser acceptance

Use an existing dashboard first. Confirm the existing table/metric/chart/note data
still appear. Move a chart and resize it; confirm its plot changes size. Use arrow
keys on the move/resize handles. Press Escape during a drag and confirm it cancels.
Try Duplicate → Undo → Redo, then Lock → Unlock. Edit widget → Placement changes
exact dimensions. Save, refresh, reopen and choose View: positions, dimensions,
widget count and IDs must persist. Check both themes; on a narrow window cards
stack without changing the desktop arrangement after widening it again.

In two tabs, open the SAME saved dashboard. Save a small change in tab A. Change
and Save in tab B without refreshing it: B must show a conflict and keep its draft.
Refresh B only after you have decided which draft to keep. Confirm a normal
notebook SQL/Python run and dataset preview still work. Report actual results;
local fixture QA does not prove these live workflows.

After acceptance capture fresh full Windows source before phase B.
Next phases remain more chart types/presentation controls, then real dataset
filters/slicers applied before aggregation/limits. No decorative inactive menus
for those unimplemented features are included in this canvas patch.

## Rollback — protect saved canvas dashboards

Before ANY production dashboard has been saved by this new editor, the backup's
ROLLBACK-CLOUD-DASHBOARD-CANVAS.ps1 can restore the original source. It verifies all
targets/backups first and refuses later edits. Run -VerifyOnly first. An actual
restore requires -NoProductionCanvasSaves as an explicit statement that no live
version 2 layouts exist. This script cannot inspect Supabase to verify that fact.
Windows test-database saves do not count as production saves.

After even ONE production version 2 save, do not restore/redeploy the old parser:
it cannot read the new layout. Keep the compatible backend and use a scoped
forward fix, or prepare a separately reviewed conversion while preserving all
saved data. No automatic downgrade, deletion, database restore or cloud cleanup
is included. Source rollback alone does not replace a live deployment.

Prepared source checkpoint is a reference package, not a fresh capture of your
Windows Git working tree or live database. Keep your original capture and backups.
