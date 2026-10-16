# Cloud frontend dependency security phase

Prepared14October2026 from the verified239-file Windows checkpoint
SHA0282d80ea9109c5f4c8d531c760b0a24a737e76820f6832ff09ef6cdd7d2d736.
Windows reported package.json SHA71d80b0a5143df9394bfe49eb71e53a2ba6513c54e2edf5c165e9280126c1193
and package-lock.json SHAf67cd21524356b0ab4d66ffc2c61b98296a3a205d563bd5a51d61a1dc5bb6a74,
matching exactly. Before implementation all239 source hashes and ZIP CRC reverified.
Prepared patch is NOT applied/deployed to the user's app yet.

## Problem and scope

User audit reports3 package entries: DOMPurify/Monaco moderate, source-map-js high.
DOMPurify3.4.8 is Monaco0.56.0's exact dependency AND an embedded ESM copy in
esm/vs/base/browser/dompurify/dompurify.js. The browser loads that embedded copy
via domSanitize.js, not the external npm dependency. Overriding a package alone
would leave vulnerable bytes in the browser. Published Monaco0.57.0 still pins
DOMPurify3.4.15, affected by the latest reported advisory; avoid a larger editor
upgrade that still needs a sanitizer remedy.

Keep Monaco0.56.0. Add exact direct DOMPurify3.4.16 plus npm override $dompurify.
Vite/Vitest alias its exact relative embedded import to the patched ESM module.
The production guard verifies the pins/import layout, rejects any embedded
sanitizer module in emitted chunks, and requires the patched module. Tests exercise
Monaco's actual sanitizer through this alias, not an editor mock.
Pin source-map-js1.2.2 with an override, satisfying all existing ^1.2.1 parent
constraints: Tailwind node, css-tree, magicast and PostCSS. It is dev/build-only
in this lockfile; no uploaded CSV/source-map processing path observed in app code.
Its extreme indexed-map offsets are rejected before text processing; normal maps
still work. The report is dependency evidence; no exploit against this app shown.

Four existing files change: frontend package.json/lock, vite.config.ts and
vitest.config.ts. Five additions: build/editorSanitizer.ts, two focused test files,
this runbook and validation JSON. No backend/API/schema/auth/storage/migration,
Supabase setting, Git commit or cloud mutation. Preserve self-hosted Python and
same-origin API. Lock semantic diff is exactly root dependencies + DOMPurify +
source-map-js; all other package versions and platform/libc metadata retained.

## Acceptance and rollback

Local: fresh npmci(ignore-scripts); audit0;4 actual sanitizer tests +2 source-map
security/compatibility tests +7 notebook tests pass; TypeScript passes; lint0errors/
9existingwarnings. Cloud wrapper build passes with editor bundle guard, /api/v1
and immutable Python assets. A negative production build with alias removed
(write:false) rejects embedded3.4.8 even though npm audit is clean.
A build-size warning remains for large existing editor chunks; no new warning
policy or feature removal introduced. Browser-after-deploy acceptance still needed.

Apply script validates package hashes, branch cloud-deploy-v1, HEAD
2443908c1a04a880fa92cd084ac260da3734f12d and cross-component source prerequisites
before writing. It backs up changed files, is idempotent, and provides scoped
rollback that refuses later edits. Python simulates byte guards/apply/idempotence/
later-edit rejection/rollback. PowerShell unavailable here; Windows execution is
an explicit next acceptance gate. Restore source via rollback then npmci; never
restore/delete database data for this dependency phase.

## Windows next steps

1.Download DataPlatform_Cloud_Frontend_Security_Patch.zip. Follow checksum-verified
inline extraction/apply steps supplied in chat. Preserve printed backup path.
If any guard fails, stop and share message; no forced edits or dependency updates.
2.In PowerShell at D:\New project\databricks-clone-v1 run each command in order;
stop at any failure, except inspect audit findings rather than treating nonzero
as permission to run auditfix:

```powershell
npm.cmd --prefix .\frontend ci --ignore-scripts --no-audit --no-fund
npm.cmd --prefix .\frontend test -- src/lib/editorSanitizer.test.ts src/lib/sourceMapSecurity.test.ts src/pages/NotebookPage.test.tsx
npm.cmd --prefix .\frontend run lint
node.exe .\frontend\scripts\build-vercel.mjs
npm.cmd --prefix .\frontend audit --package-lock-only --include=dev
```

Expected13tests across3files; lint0errors with9existingwarnings; build markers
EDITOR_SANITIZER_BUNDLE=PASS, CLOUD_FRONTEND_BUILD=PASS, CLOUD_API_BASE=/api/v1,
SELF_HOSTED_PYTHON_ASSETS=PASS. Audit0vulnerabilities/exit0 at time prepared;
if registry adds an advisory, report it before deployment. No full backend rerun.
Send outputs before deployment. Current production continues with original source.
3.After Windows gates pass, publish to the SAME existing Vercel project using
existing deploy --prod flow. Recheck actual new deployment health200/200 and
notebook editor/render/save/SQL/Python at custom domain. Browser smoke after
new deployment is pending and must not be replaced by build evidence.
4.Capture/inspect fresh full Windows source after phase Windows/live acceptance.
Prepared244-source ZIP is a reference, not a capture of the user's updated repo.

## Primary sources reviewed

- https://github.com/advisories/GHSA-cmwh-pvxp-8882 (fixed3.4.11)
- https://github.com/advisories/GHSA-vxr8-fq34-vvx9 (fixed3.4.9)
- https://github.com/advisories/GHSA-55q2-fjhq-7xh7 (fixed3.4.13)
- https://github.com/advisories/GHSA-c2j3-45gr-mqc4 (fixed3.4.12)
- https://github.com/advisories/GHSA-6688-9rhm-gjv2 (fixed3.4.16)
- https://github.com/advisories/GHSA-68fv-2mgg-jv7q (fixed1.2.2)
- https://github.com/cure53/DOMPurify/releases/tag/3.4.16
- https://github.com/7rulnik/source-map-js/releases/tag/v1.2.2
- https://github.com/microsoft/monaco-editor/releases
Published npm metadata independently read for exact versions/dependencies/integrities.
Monaco's inspected path uses per-call config and string sanitization, no IN_PLACE
or setConfig in that path; attacker control of Trusted Types policy not observed.
Do not label all reported advisory configurations as directly exploitable here.
