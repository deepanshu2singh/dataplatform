# DataPlatform visual design phase

Prepared 15 October 2026 from the actual Windows checkpoint
cloud-design-baseline-20261015-005038-5262e3f5.zip.
ZIP SHA256: f151d4b41f9c679292840160fef2a0a18608ae7b79f8e19a8f76fcae49328a3e.
All 245 captured source hashes and ZIP CRC verified. App code exactly matches
previous prepared frontend security source. One additional reference handoff and
fresh user-verification metadata are the only differences. Existing branch
cloud-deploy-v1, HEAD 2443908c1a04a880fa92cd084ac260da3734f12d.

## Changes

The original notebook insertion buttons explicitly created SQL cells and had no
text colour. Monaco was fixed to vs-dark and index.css forced its background.
There was no user theme preference; Tailwind dark variants followed the OS.

This phase adds one Light / Dark / System preference, stored only in this browser
under dataplatform-theme. The same-origin external theme-init.js applies it before
React starts without inline script or weakened CSP. Storage failures retain a
session-only choice; OS changes and cross-tab changes are synchronized.
ThemeProvider wraps the app including authentication, error boundaries, lazy
routes and the standalone dashboard viewer. It never writes an account setting.

The warm neutral palette uses Cloud Milk, Floral White, Smoky Black, Olive/Bone,
Moss Velvet and Lavender. Shared Tailwind scales retain all existing state variants.
Body foreground, native controls, placeholders, focus, dialogs, tables, charts and
Monaco respond together. Self-hosted editor themes use the existing local Monaco
instance and worker. Font stack uses system fonts; no remote font request.

Home replaces duplicate capability cards with real recent notebooks from the
existing authenticated GET /notebooks, sorted and bounded to four. It has loading,
empty and retry states; requests are cancelled/stale responses discarded. Existing
notebook, dataset and dashboard routes remain connected. No invented activity,
counts or charts. No new API endpoint.

Notebook Above / Below buttons open the accessible cell-type dialog and insert
SQL, Python or Markdown at the requested position through the existing insertion
function, preserving cell IDs, contents, limits, dirty state and save format.
Move/delete/run/copy/reset and selected-dataset flows retain their existing logic.
Both dashboard renderers use coordinated series/slice colours, axis/legend/tooltip
colours and short 220ms chart animation; reduced motion disables JS chart animation
and CSS motion. Dashboard title/description inputs gain explicit accessible names.

## Validation and limits

Local fresh locked dependency installation PASS; package.json/lock unchanged.
Full frontend suite: 123 passed across 23 files. Added tests cover theme persistence,
system/cross-tab preference, unavailable storage and before-paint bootstrap; real
recent notebook loading/retry; all three insertion types both above and below,
position, focus restoration, content preservation and persisted payload.
TypeScript and cloud wrapper production build PASS; patched sanitizer included,
embedded sanitizer excluded; API /api/v1 and immutable self-hosted Python assets
verified. Lint 0 errors / 9 existing warnings; existing large-chunk warning retained.
Lock-based development-inclusive audit: zero known vulnerabilities at preparation.

Chromium production-build QA with synthetic API fixtures and the existing
production CSP: 24 screen variants reviewed at 1440x1000 and 390x844. Home,
notebook, dataset/schema/preview, upload dialog, notebook list, dashboard builder
and viewer, bar/line/pie/donut, settings, navigation, login and registration covered.
1,078 sampled rendered HTML text/background pairs meet normal/large-text contrast
thresholds; this sample excludes editor/SVG tokens and is not a full WCAG audit.
Real Monaco, same-origin workers and real self-hosted Pyodide run. SQL result uses
a fixture API response; Python executes real code on the five-row fixture CSV.
Theme toggle/reload and insertion/save/reload retain the expected cell order.
No unexpected runtime/CSP errors; auth/me 401 responses are intentional logged-out
fixtures. Mobile Home/notebook have no page-level horizontal overflow. Internal
QA screenshots are not delivered or saved as user artifacts.

Backend, migrations, auth/session/API/SQL runtime, upload/storage adapters, cookie
and CSRF logic, dependency files, Vercel settings and immutable Python files remain
byte-identical. No database operation, Git commit, deployment or cloud cleanup run.
Mocked API/browser QA is not evidence of new live-cloud acceptance. The user's
Windows check and actual post-deploy inspection remain required.

## Apply on Windows

1.Download DataPlatform_Cloud_Visual_Design_Patch.zip.
2.Use the checksum-verified extraction/apply block supplied in chat. It checks
branch/HEAD and all changed/required inputs before writing. Preserve the backup
path printed as cloud-visual-design-rollback-... . Expect 21 package files.
3.In PowerShell at D:\New project\databricks-clone-v1 run each command and stop
at the first failure. Dependencies are unchanged; use the installed dependencies
from the accepted security phase:

```powershell
npm.cmd --prefix .\frontend test
npm.cmd --prefix .\frontend run lint
node.exe .\frontend\scripts\build-vercel.mjs
```

Expected 123 tests / 23 files; lint 0 errors / 9 existing warnings; build markers
EDITOR_SANITIZER_BUNDLE=PASS, CLOUD_FRONTEND_BUILD=PASS, CLOUD_API_BASE=/api/v1,
SELF_HOSTED_PYTHON_ASSETS=PASS. If node_modules is missing, npm ci with the locked
versions is appropriate; never run npm audit fix or unrelated dependency updates.
Send the result before production deployment.
4.After Windows checks pass, deploy to the SAME existing project with
npx.cmd --yes vercel@63.1.2 deploy --prod --scope deepanshu1927.
Use the actual new deployment hostname for health checks. At the custom browser
origin hard-refresh, check both themes and persistence, recent notebook links,
cell chooser/order/save/SQL/Python and existing dataset/dashboard controls.
5.After acceptance, capture fresh full Windows source. The supplied prepared
source ZIP is a reference, not a capture of the user's newly applied repository.

## Scoped rollback

If no later phase edits exist, the backup contains ROLLBACK-CLOUD-VISUAL-DESIGN.ps1
and ROLLBACK.json. Load the script as a scriptblock, pass -BackupRoot explicitly,
run -VerifyOnly first, then restore. Every target/backup is verified before any
restore; later edits stop rollback rather than being overwritten. Newly added
phase files are removed, originals restored. Source rollback alone does not
replace the live deployment: after restored-source verification, redeploy the
same existing project deliberately. Database and storage are never rolled back.

## Sources

- https://tailwindcss.com/docs/dark-mode
- https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html
- User's two current-app screenshots and four palette/design references.
