# Forgotten-password recovery

Scope agreed 17 October 2026: implement forgotten-password recovery first; then
start Data export/privacy as a separate phase after recovery acceptance/checkpoint.
Notifications remain deferred. Baseline is the actual accepted Security checkpoint
cloud-settings-security-accepted-20261017-213136-1ed233f0.zip, SHA256
5fbee2cc80f805f876906f3908cbf6e5dc72887ea0a1225aa6917c8025fa06bd,
Git fe0172bf38081c3e67e67c9c6322638585abbc2c, tree
48914bcfd26fa82f248adad9c32f84b4573b4cff, branch cloud-deploy-v1.

## Connections and implementation plan (before source changes)

Keep custom FastAPI auth, existing Resend credentials/sender, shared durable email
delivery budget, Origin/CSRF, password policy, session-version revocation, mandatory
email verification, themes/branding and all dataset/notebook/dashboard paths.

Add an anonymous recovery request and confirmation API, dedicated allow-listed
schemas and service. Extend users with seven nullable/defaulted recovery fields
through additive migration20261017_0008 after0007, two counter constraints; update
the model, migration-head tests and deployment runtime head guard. No user-data
rewrite, new dependency, environment variable or cloud service.

Use eight random decimal digits, a fresh random nonce and an HMAC digest bound to
purpose/user/email/current session version. Store only the digest, never plaintext
codes or passwords. Ten-minute expiry, one use, five code attempts per challenge,
60-second send cooldown and five sends per account/hour. A newer code replaces
the earlier code. Password change/global signout also invalidate outstanding reset
codes through the bound session version. Lock and refresh the user row for request
and confirmation; use PostgreSQL time. Failed code attempts commit their count.

Use two constant global per-minute request/confirmation counters in the existing
delivery-limit table to limit anonymous abuse without storing IPs or creating an
unbounded email-address log. Share the existing90/day,10/min provider budget with
verification; reserve each code/notice in its actual current day/minute window.
A failed or uncertain delivery conservatively consumes its reservation.
No database lock spans provider I/O. Provider errors/logs never echo secrets.

Requests return identical202/no-store bodies for missing, inactive, rate-limited
accounts and uncertain email delivery. Configuration failures/global request-rate
limits apply independently of account existence. Use a common minimum response
duration and a shorter bounded email transport timeout to reduce timing leaks;
this does not claim perfectly identical timing during infrastructure failures.
Completion notices reserve a fresh current-window budget and are attempted after
the password/version commit. Quota/database/delivery failures cannot undo a
successful reset and are logged without private data. Notification delivery is
best effort, not guaranteed when the provider/budget/database is unavailable.

Successful confirmation atomically hashes the new password, increments the session
version and consumes the challenge. No auto-login or Set-Cookie, no identity/role/
verification-status changes. Already-authorized requests may finish. Reset is
available to active unverified accounts too; they still must verify after login.

Add a branded Light/Dark public /forgot-password page linked from Login, using
email -> code plus new password/confirmation -> explicit return to sign-in.
No secrets in URL, browser storage, API responses or validation echoes. Explicit
labels, show/hide password, resend cooldown, disabled double submits, latest-request
cancellation, draft/leave guards. PublicRoute keeps signed-in users on their existing
workspace; Settings Change password remains their normal authenticated flow.

Affected source: auth routes; main validation redaction; users model; new schemas,
service and migration; migration-head tests/runtime guard; App/Login/new recovery
page; related frontend/backend/native tests; scoped phase docs/Windows verifier.
Dependency manifests/configs, email verification service and accepted Security
service stay unchanged. No Data export/deletion work in this patch.

## Acceptance

Verify allow-lists/redaction/Origin, HMAC separation and version binding, expiry,
single use/replay, wrong-code limits, request cooldown/hour/global budgets, transport
failure semantics, actual atomic native PostgreSQL/concurrency, preservation of
verification/name/owned work and other-account isolation. Verify old cookies and
old password fail after reset, new password works with normal login; no auto-login.
Test branded/light/dark/responsive screens, resend, failed-code retry and abandoned
request cancellation/unsaved guards. Run accepted auth/email/Security/data tests,
full frontend/lint/cloud build and unchanged-input guards. No invented native/live
evidence: actual Windows Docker verification precedes production migration/deploy.

After Windows: read-only actual cloud revision, explicit guarded0007->0008 rollout,
matching deployment, exact new-host health and user live recovery/regressions; then
scoped Git push/full checkpoint/independent actual ZIP+Git verification.

## Rollback

Scoped byte backup/restore before cloud rollout; refuse later edits. Once deployed,
retain0007 version enforcement. An old backend or dropping version columns can
revive revoked cookies. Prefer fix-forward or reviewed UI-only rollback retaining
the account-security backend; never disable verification/CSRF. Native downgrade
tests are disposable-test-only; no automatic Supabase downgrade or cleanup.

## Candidate local validation

122 focused backend/recovery/Security/email/config/health/observability/redaction
cases PASS.25 native cases skipped locally:12 new recovery/migration plus13 existing
verification cases. No local native PostgreSQL result is claimed. All are required
in Windows Docker before cloud rollout. The old cached runtime had a broken native
extension; a fresh isolated environment using pinned app/test requirements passes.
No application dependency/version changes were made to repair the test runtime.

Full frontend210tests/34files PASS. After small copy/reduced-motion updates,
focused32tests PASS; lint0errors/9existingwarnings. TypeScript/cloud wrapper/API
bootstrap graph/editor sanitizer/self-hosted Python/branding PASS.
Production cloud-build browser QA: Chromium153, synthetic API fixtures;1440light/
dark,390light,320dark. Code request, wrong-code retry preserving password, success/
return to login, API body/origin, no credential storage, no horizontal overflow and
zero page errors PASS. All four internal screenshots visually reviewed. This is
not actual cloud email or native PostgreSQL evidence. No screenshots are delivered.

A quota-window edge case was resolved before packaging: completion notices reserve
using their own current DB time, not an earlier request's day/minute. A unit check
covers clock source and notification budget failure never undoing committed reset.
Actual user Windows/live/production rollout and phase closure remain pending.

Final request-error refinement keeps rejected emails editable and allows code entry
after an uncertain send. Two new frontend cases added; final focused34tests PASS
and request-validation redaction2cases PASS; cloud build and four-browser-layout
fixture checks rerun. The earlier full-suite210 count is not presented as a new212
full-suite run. Actual Windows/native gate remains required.


## Accepted Windows and production evidence — 17 October 2026

This release record supersedes the candidate/pending rollout wording above;
earlier local test counts remain historical and are not Windows test totals.

User reported CLOUD_FRONTEND_BUILD=PASS, CLOUD_API_BASE=/api/v1,
SELF_HOSTED_PYTHON_ASSETS=PASS, CLOUD_BRAND_ASSETS=PASS,
BUILD_INPUT_FILES_UNCHANGED=PASS and WINDOWS_PASSWORD_RECOVERY_CHECKS=PASS.
The final guarded Windows verifier includes native PostgreSQL/backend checks,
frontend tests/lint/build and input guards. No raw Windows totals were supplied.

Actual Supabase SQL preflight was 20261017_0007. The guarded additive migration
completed with resulting revision 20261017_0008. Matching manual production
deployment: dataplatform-v1-q7qtknwie-deepanshu1927.vercel.app.
Inspect: https://vercel.com/deepanshu1927/dataplatform-v1/5sqjxLXExVYbXxb4wiRvzDoV2agz
App: https://dataplatform.sprout-sql.com
Both health endpoints returned HTTP200; alive, ready, database=ok, migrations=ok.

User live test-account acceptance: reset-code email received; incorrect code
rejected; correct code/password reset succeeded; previously signed-in session
blocked after refresh; old password rejected; new password works and email
verification retained; password-change notification email received. All PASS.
Original-account sign-in/verified status, existing dataset preview, notebook SQL
and Python, dashboard charts/saved layout and saved profile name/theme all PASS.
These are user-reported production results, not agent-generated live requests.

Release helper stages only the reviewed 22 paths, publishes without force-push,
and exports all 341 tracked source files with hashes. Untracked downloads and
private/runtime files are excluded. The actual resulting Git commit and uploaded
full checkpoint require independent verification after the helper completes.
No extra deployment, migration, cloud command or test rerun is part of closure.
Data export/privacy is next after that checkpoint is accepted; Notifications
remain deferred. No blanket GDPR compliance claim is made.
