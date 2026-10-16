# Dashboard query-column dropdown correction

Status: prepared and locally checked. Windows apply/checks and deployment of this correction are pending.

The current presentation deployment is pyg55odcz. The user supplied both raw health HTTP 200 results and accepted stacked/scatter/combo charts, Save/refresh and viewer matching. Two current screenshots were inspected: the charts render, while data-column controls are text inputs. These inputs used an HTML datalist, whose browser suggestions did not provide an obvious dropdown. This correction replaces those inputs with native select controls.

## What changes

X/category, X/numeric, Y/numeric, series, combo second value, metric value and table default-sort controls now provide real dropdowns. Choices come from actual returned query columns, including SQL aliases. Formatting dropdowns retain their behavior. Table visible columns remain selectable checkboxes; no typed comma-list of column names is needed when fields are unavailable.

Open a widget's pencil/Edit control. Existing loaded widget results supply fields immediately. For a new or changed query, choose Dataset, enter the SQL, then click Load query fields. It requests one result row through the existing authenticated SQL route only to discover the columns. Choose from the dropdowns, Preview, Done, and Save. No automatic SQL request occurs merely because a field, chart type, palette or format is changed.

A fresh widget may still show its saved/default name such as category or value. If it is not among the returned query columns, that selection is marked as missing rather than silently changed. Choose the correct returned field. Optional series and default sort offer None. A stacked chart requires an actual series. Changing the dataset or query cancels pending field discovery; a late result cannot install old choices. Loading failures show an error and preserve known same-query fields and saved settings.

The list is the query RESULT schema, not every raw dataset column. For example, SELECT SUM(revenue) AS total_revenue produces a total_revenue choice. A column not selected by the SQL does not appear. Numeric types are still validated by Preview; dropdown names do not invent or infer numeric data.

## Apply on Windows

Download DataPlatform_Cloud_Dashboard_Column_Selectors_Patch.zip. In the existing project PowerShell, run the chat's checksum-guarded command. Paste the ZIP's full path. It extracts the package beside the download, verifies branch/HEAD and exact source hashes, backs up the targeted files, applies five files, then runs the bundled frontend verification. Do not replace the project directory with the prepared source checkpoint.

This is an in-phase B correction. Its input is the verified accepted-canvas actual checkpoint, plus the exact presentation patch already applied and the one-file backend test correction confirmed in the user's output. The prepared reference has 274 entries; it is not described as a fresh post-B actual Windows capture. All existing candidate entries were checked against that chain. The apply guard includes the corrected backend test hash. If any input differs, it stops before writes; do not force it. Generated capture-only CLOUD_USER_VERIFICATION.json is not an on-disk prerequisite.

The package changes two existing frontend files (the shared editor and its tests) and adds a verification script plus two phase documents. No backend/runtime/dependency/migration/hosting files change. Actual saved field-name strings and layout version 3 remain the same.

## Windows checks

The bundled VERIFY-CLOUD-DASHBOARD-COLUMN-SELECTORS.ps1 runs all frontend tests with the already verified Windows flags --maxWorkers=2 --testTimeout=15000, then lint and the guarded cloud build. It checks the same seven build/dependency inputs remain unchanged. It does not rerun the unchanged backend's already-passed 241-test suite or build Docker images.

Expected final markers:

    CLOUD_FRONTEND_BUILD=PASS
    CLOUD_API_BASE=/api/v1
    SELF_HOSTED_PYTHON_ASSETS=PASS
    BUILD_INPUT_FILES_UNCHANGED=PASS
    WINDOWS_DASHBOARD_COLUMN_SELECTORS_CHECKS=PASS

If a check fails, share the actual failure above the final stop message. No deployment is run by applying or checking this package. Share test summaries and markers before deployment.

## Deploy and check the live controls

After Windows checks pass, deploy from D:\New project\databricks-clone-v1 with the same existing command:

    npx.cmd --yes vercel@63.1.2 deploy --prod --scope deepanshu1927

Record the new exact deployment host and verify /health/live and /health/ready through authenticated vercel curl, as before. Save intended browser edits before loading the new build. On the existing Presentation Check dashboard, hard-refresh to load the latest assets, then:

1. Edit the saved stacked chart. X=month, Y=revenue and series=region should remain selected, now with dropdown arrows. Their options should be the actual query results. Preview must retain the same four bars and totals.
2. Edit Scatter and Combo. X/Y, series and second-value dropdowns must preserve the saved field names. Change a field using a dropdown and verify Preview, Done, Save, refresh and View still agree. Restore the intended choices before the final Save.
3. On a test widget, change SQL to SELECT region, SUM(revenue) AS total_revenue FROM dataset GROUP BY region ORDER BY region. Load query fields. The returned choices must include region and total_revenue. An old revenue field should be visibly marked missing until total_revenue is selected. Expected region values remain 3,000/6,000/9,000.
4. On an unfinished test widget only, change Dataset or SQL and reload fields. Old options must not reappear from an earlier request. SQL errors should leave a readable explanation. Do not overwrite an important saved chart with the temporary query by mistake.
5. When checking metrics/tables in the remaining phase B steps, use their value/sort dropdowns and visible-column checkboxes. Check light/dark and narrow layouts. Format choices and chart values must still agree with the known fixture.

After this correction is accepted, continue the remaining table/metric/readability checks for B, then capture fresh actual Windows source before phase C filters/slicers. No extra audit or unrelated feature phase is added.

## Rollback

Backups are under checkpoints/cloud-dashboard-column-selectors-rollback-<timestamp>-<id>. Each contains originals, ROLLBACK.json and ROLLBACK-CLOUD-DASHBOARD-COLUMN-SELECTORS.ps1. The scoped rollback checks every relevant current/backup hash before restoring, rejecting later edits. It restores these selector changes only. This is source rollback; redeploying the restored source is a separate action.

It preserves the existing v3-compatible backend and saved JSON. The earlier v2-only parser still must not be redeployed now that live dashboards use layout 3. Do not use the earlier -NoProductionPresentationSaves assertion; it is no longer true.

## Local evidence and limits

155 frontend tests across 29 files passed, including 9 shared-editor tests. TypeScript and the production cloud build passed, including the original actual Monaco sanitizer bundle guard and self-hosted Python assets. Lint has zero errors and the same nine existing warnings. Dependencies and every backend file are byte-identical to the input reference.

Production-build Chromium with the actual production CSP and synthetic APIs passed native SELECT verification, keyboard field selection, all 10 chart previews, light/dark viewer rendering,390 px form fit, v3 Save/refresh with exact placement, and409 draft preservation. The light/dark/mobile form screenshots were visually inspected and are not deliverables. Stale discovery cancellation, aliases, missing fields, load/retry errors, optional clearing, metric/table controls and unchanged configs are covered by component tests.

A local symlinked dependency directory initially failed the sanitizer guard's exact module-path check. Using an isolated real copy of the unchanged installed dependencies resolved that environment-only issue; the guard and all dependency files were retained. Native PowerShell is unavailable locally, so byte guards/application/idempotence/conflict/rollback were simulated. Windows and live acceptance of this correction remain required. See CLOUD_DASHBOARD_COLUMN_SELECTORS_VALIDATION.json for the evidence boundary.
