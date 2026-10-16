# Cloud brand integration — 16 October 2026

## Baseline and assets

Prepared against published branch `cloud-deploy-v1`, commit `70a47dca5e48926d8f6cc84bbad9bc4c25388619`, tree `fc52befa2125e27fd1689df7cc22043e769cfc05`. This is the reviewed current application, not an earlier baseline. The preceding actual Windows checkpoint was `cloud-dashboard-canvas-accepted-20261016-004600-8287711b.zip` (SHA-256 `a6d14c2cc5f47e31e3e094e0de6f31c31aaef6a1c71390dd8e42007535e1d709`); the subsequent Git synchronization changed supporting documentation/ignore rules, not application behavior.

Supplied asset ZIP: `data-platform-brand-assets(1).zip`, SHA-256 `ca900a3b7052d78e2c9488fac4576e1184199645cddab8018090cdbca52380f7`. All ZIP CRCs passed. Supplied raster/icon/SVG asset bytes are copied unchanged. The supplied manifest gains root identity/start/scope metadata so its icon paths are explicitly connected to the existing router.

## Connected surfaces

- Browser ICO, SVG and PNG icons; Apple touch icon; manifest icons for platform launchers/bookmarks. Versioned icon links address the previous favicon cache.
- Accessible compact mark with real text in navigation and both authentication screens. The text follows the existing foreground theme token rather than using white letters on a light surface.
- Supplied large homepage logo on its navy panel, scaled without distortion. The transparent alternative and original large icon remain available as supplied source assets.
- Branded initial HTML, auth-loading and lazy-route fallback. No timeout, fake progress, image-load wait or extra request is inserted into the existing ready/loading transition.
- Desktop loading uses the supplied full illustration. Mobile loading uses the supplied compact icon plus readable HTML title/status; screen readers receive a real status label and reduced-motion preference disables animation.
- Browser theme colour follows startup, manual, system and cross-tab theme behavior through the existing theme lifecycle.

Brand styles are isolated in `frontend/public/brand.css`; existing dashboard/notebook palettes and layouts are preserved. Navigation through the logo uses the existing router and unsaved-work blocker. Login/registration validation, cookies, API routes, data ownership and all dataset/notebook/dashboard persistence logic are unchanged.

## Scope exclusions

No backend, migration, dependency/lockfile, Vercel/CSP configuration, storage policy, database, SMTP or email-verification change. No service worker/offline promise or guarantee of search-engine indexing. Browser icons/metadata do not expose private application content to crawlers.

## Validation and rollout

See `CLOUD_BRAND_INTEGRATION_VALIDATION.json` for local evidence and exact pending Windows/live acceptance. Use the packaged apply helper's VerifyOnly first, then apply, then `scripts/verify-cloud-brand-integration.ps1`. The package guards the entire unchanged committed source using Git blob identities so ordinary Windows CRLF normalization is supported without weakening source comparison.

The helper records byte-verified originals under `checkpoints/cloud-brand-rollback-*`. Scoped rollback checks every target and backup before restoring, refuses later edits, and never resets Git history. A source rollback affects the hosted app only after a deliberate deployment of the restored source.
