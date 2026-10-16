# DataPlatform dashboard chart and presentation update

Status: prepared and locally verified against the accepted canvas checkpoint. Not yet applied, tested on Windows, deployed, or accepted live.

## What this adds

Ten chart types: existing bar, line, pie and donut, plus horizontal bar, area, stacked bar, stacked area, scatter and combo (bar plus line).

Open a dashboard, click a widget's pencil (Edit widget), then use the presentation controls below the SQL box. Click **Load query fields** to discover the actual columns returned by that widget's dataset and SQL query. It requests one row through the existing authenticated SQL endpoint; it does not treat that row as a total. Select the columns, choose a chart, adjust palette, legend, grid, labels, axis titles, line shape, numeric formatting and returned-point order. Style changes use the last loaded result without automatically rerunning SQL. Click **Preview** to validate the selected fields, **Done** to close the editor, then **Save** to keep the dashboard settings.

Scatter needs numeric X and Y columns. Stacked charts need a category, numeric value and series column, with exactly one row per category/series pair. Aggregate duplicate pairs in SQL using GROUP BY; the app never invents an aggregate from an incomplete browser result. At most 12 series are supported. Combo needs two different numeric Y columns; its line can use a separate right axis. Numeric formatting is shared by both combo values; use Number when their units differ and name the axes clearly. Pie/donut reject negative numbers and show an explanation for an all-zero result. Null numeric points are omitted with a visible count; gaps between series categories remain missing rather than being turned into zero.

Tables now have local sorting, pages of 10/25/50/100 rows, density, visible columns, column width/alignment, per-column formats and row numbers. Choose table defaults in Edit widget and Save. Clicking a header, changing rows per page or moving pages in the viewer only changes that viewing session. **Reset view** restores the saved defaults. Sorting operates on the returned query rows; use SQL ORDER BY to sort before the output limit. Charts have **View chart data** to inspect those returned rows.

Metrics have a real editable label, numeric/text/currency/percent formats, decimal precision, compact numbers and prefix/suffix. Choose whether percent source values use `25 = 25%` or `0.25 = 25%`. Existing percentages retain their former meaning. No comparison percentage is fabricated.

Dataset filters and slicers are the next phase C. This phase provides chart/presentation controls and bounded table sorting, not a filter over underlying dataset rows.

## 1. Download and apply

Download DataPlatform_Cloud_Dashboard_Presentation_Patch.zip. Keep Docker Desktop running. In the same Windows PowerShell used for this project, run the checksum-guarded command supplied in chat. Paste the ZIP's full path when asked. The command checks the ZIP, extracts it beside the download, verifies the baseline, backs up changed files, then applies only this patch. Do not replace the project folder with the prepared source checkpoint.

The apply script requires the existing cloud-deploy-v1 branch and Git HEAD 2443908c1a04a880fa92cd084ac260da3734f12d. It accepts only original baseline bytes or this update's exact bytes. It checks every guarded input before writing. A mismatch stops before project changes. Do not bypass a mismatch or reset your work.

The input is cloud-dashboard-canvas-accepted-20261015-215326-b539f902.zip, SHA256 47d756eb7d8075f4adf7a2a943dd74b2c5abbd3b194431bfcbb551937f80f152, all 261 manifest hashes and CRC verified. Its generated CLOUD_USER_VERIFICATION.json is capture metadata, so it is not treated as an on-disk prerequisite.

## 2. Run Windows checks

The chat command then runs the bundled VERIFY-CLOUD-DASHBOARD-PRESENTATION.ps1 against D:\New project\databricks-clone-v1. It uses the already accepted build recovery approach: temporary Dockerfile copies outside the project, a 120-second pip network timeout, five retries, and a shared download cache. Project Dockerfiles and dependency files are not rewritten. This can take several minutes; Docker shows progress.

It verifies the Compose test database is the disposable local postgres-test database, builds both test images, starts the test API, runs the full backend suite (including real PostgreSQL and new presentation API tests), then all frontend tests, lint and the guarded cloud build. It stops at the first failure and checks seven original build/dependency inputs remain unchanged. No production migration, Git commit, Vercel deployment or cloud cleanup is performed.

Success ends with:

    CLOUD_FRONTEND_BUILD=PASS
    CLOUD_API_BASE=/api/v1
    SELF_HOSTED_PYTHON_ASSETS=PASS
    BUILD_INPUT_FILES_UNCHANGED=PASS
    WINDOWS_DASHBOARD_PRESENTATION_CHECKS=PASS

Share the final test summaries and markers. If it fails, share the final error and failing test, not credentials. Do not redeploy before these checks pass.

## 3. Deploy after checks pass

In PowerShell at D:\New project\databricks-clone-v1:

    npx.cmd --yes vercel@63.1.2 deploy --prod --scope deepanshu1927

If it says Not authorized, stop and check whoami and project inspect as before; no project/account replacement. Record the newly returned deployment URL. Test that exact new URL, not an old `$deployment` variable:

    npx.cmd --offline --yes vercel@63.1.2 curl /health/live --deployment PASTE-NEW-DEPLOYMENT-HOST --scope deepanshu1927 -- --show-error --connect-timeout 10 --max-time 60 --write-out "\nHTTP_STATUS=%{http_code}\n"
    npx.cmd --offline --yes vercel@63.1.2 curl /health/ready --deployment PASTE-NEW-DEPLOYMENT-HOST --scope deepanshu1927 -- --show-error --connect-timeout 10 --max-time 60 --write-out "\nHTTP_STATUS=%{http_code}\n"

Both must return 200; readiness should show database and migrations ok. No new database migration is needed for this update.

## 4. Check the live app

Open the normal app URL. Use a test dashboard with a real owned dataset, leaving important dashboards available as reference.

- Confirm an existing chart, table and metric still load. Drag/resize, duplicate, Undo/Redo and lock should still work.
- In Edit widget load query fields, choose a returned numeric value and category. Try the new chart types. Stacked requires a real series and aggregate query; scatter needs two numeric fields; combo needs a second numeric value. Check actual marks, legend, axes and data view.
- Change palette/labels/axes/formatting, click Preview, Done and Save. Refresh the browser, reopen the editor, then open the viewer. Settings and placement must remain the same.
- Test table column visibility, width, alignment, currency/decimals, density, page size and saved sorting. In the viewer sort/page/reset and confirm the saved defaults were not overwritten.
- Test a metric label and percent scale. Confirm the number agrees with the SQL result; `0.25` with fraction scale must display `25%` at zero decimals.
- Check light/dark and a narrow screen. Confirm the edit preview draws real chart marks and all controls remain reachable. Mobile viewing must not change desktop coordinates.
- Two tabs: change/save in one, then save an older draft in the other. The second tab should show the conflict and retain its draft.
- Recheck notebook SQL/Python and dataset preview. Earlier upload acceptance remains historical; no new byte-resume claim is made.

Share these results and the deployment URL. Only then capture a fresh actual Windows checkpoint before beginning phase C.

## Compatibility and rollback

The database's existing dashboard JSON holds these settings: no schema migration or dependency update. Layout versions 1 and 2 still read. A deliberate dashboard Save writes layout version 3, preserving canvas positions and settings. A v2 client cannot overwrite a v3 dashboard; stale row versions still return 409 without discarding the local draft.

Backups are under checkpoints/cloud-dashboard-presentation-rollback-<timestamp>-<id>. The backup contains originals, ROLLBACK.json and ROLLBACK-CLOUD-DASHBOARD-PRESENTATION.ps1. Before this build has saved any production dashboard, verify rollback with `-VerifyOnly`, then use the rollback script with `-NoProductionPresentationSaves` only if that statement is true. It checks all file states and backup hashes first and refuses later edits.

After any production v3 Save, the previous v2-only backend cannot read that dashboard. Do not blindly redeploy the old code or assert -NoProductionPresentationSaves. Keep a v3-compatible backend or prepare a reviewed compatibility repair. No data deletion/downgrade is performed automatically. Source rollback does not undo a Vercel deployment.

## Local validation and limits

See CLOUD_DASHBOARD_PRESENTATION_VALIDATION.json. Linux unit suites pass; the production frontend builds with API /api/v1, actual Monaco sanitizer guard and self-hosted Python assets. Existing nine lint warnings remain; no new warnings/errors. Native Windows PowerShell and PostgreSQL are not available locally, so script byte guards were simulated and the real database/API integration suite is an explicit Windows gate.

Production-build Chromium uses synthetic API data with the actual production Content Security Policy. It exercises real React/Recharts, all ten chart types in viewer and edit preview, light/dark desktop and narrow layouts, table interactions, field discovery, v3 Save/refresh, exact placement and 409 draft preservation. This is not live Supabase acceptance or a full accessibility certification. Internal QA screenshots are not deliverables.

Technical references used: official Recharts ComposedChart (https://recharts.org/en-US/api/ComposedChart/), ScatterChart (https://recharts.org/en-US/api/ScatterChart/), ResponsiveContainer (https://recharts.org/en-US/api/ResponsiveContainer/), Tooltip (https://recharts.org/en-US/api/Tooltip/). Existing Recharts dependency is reused.
