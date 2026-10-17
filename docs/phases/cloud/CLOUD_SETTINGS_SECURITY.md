# Settings Security: password changes and account-wide sign-out

Baseline: cloud-settings-profile-accepted-20261017-173608-80423007.zip,
SHA25673fd12bb3799fac365c702a696c587c35cda358134c62aeaed2f49ff160ffe4b,
commit65ca3b95d344104a06236098441ae5f1fd1af779, branchcloud-deploy-v1.
Status: Windows/native verification and live production acceptance PASS on
17 October 2026 (Europe/London). Scoped Git release and full checkpoint prepared;
independent actual archive/Git verification remains the final phase closure gate.

## Connections and scope

- POST /api/v1/auth/password accepts current_password/new_password only.
- POST /api/v1/auth/sessions/revoke accepts current_password only.
- Both use existing active verified-account and Origin/CSRF boundaries, validate
  current credentials, and invalidate all prior sessions including this browser.
- The new schemas forbid extra fields. Passwords are not normalized or trimmed;
  existing8–128character new-password policy and Argon2 implementation stay.
- No identity/email/role/verification updates, device list, MFA or recovery flow.
- Secret-bearing malformed requests get a fixed422 response, not echoed input.
  Wrong current password returns400, so it does not trigger the global401 logout
  interceptor. Rate limits return429/Retry-After. Error bodies/logs do not contain
  submitted passwords or stored hashes. Successful responses are204/no-store.

Migration20261017_0007 adds users.session_version(default0), security_attempts and
security_window_started_at plus nonnegative/bounded constraints. No existing
password/verification/profile/work rows are rewritten. Login cookies carry sv;
every authenticated request compares a strict nonnegative integer with DB state.
Preexisting cookies without sv remain valid only for accounts still at version0.

The service locks and refreshes the authenticated user row and rechecks session
version/active/verified status. PostgreSQL clock and a durable per-account window
serialize attempts across workers. Both endpoints share five attempts/15minutes,
including wrong and same-password attempts; failure counts commit. Expensive
Argon2 work runs off the event loop. A successful atomic password/version update
invalidates older cookies. Already-authorized running requests may finish.

Successful security responses intentionally send no Set-Cookie. Server-side
revocation already invalidates the old cookie. Avoiding cookie deletion prevents
a delayed response from erasing a newer concurrent login's valid HttpOnly cookie.
The shared frontend state clears on success and redirects to login. A subsequent
login replaces the stale cookie; existing sidebar logout still clears cookies.
The response never issues a replacement authenticated session or token.

AuthContext cancels superseded requests; late responses cannot clear a newer
session. Completion notice is held in shared account state across routing, because
ProtectedRoute's own redirect can replace router-state notices. Fixed notice text
never echoes arbitrary input. Passwords stay only in mounted form state, with
clear-fields/show-hide controls; no browser storage. Fields survive internal
Settings tabs; unsaved-work guard protects leaving. Pending requests disable both
forms and tab switching. An unsaved profile must be saved/discarded first.

## Validation and rollout

See CLOUD_SETTINGS_SECURITY_VALIDATION.json and the external package runbook for
the exact validation evidence. Synthetic browser API fixtures are separate from
native PostgreSQL and actual live cloud behavior. No raw Windows totals were supplied.

Apply/test helpers perform no cloud migration, deployment, Git operation or cleanup.
The Windows verifier checks the accepted HEAD, fixed disposable Docker test URLs,
full backend/native migration+concurrency cases, full frontend/lint/cloud/branding
and unchanged input hashes. Require WINDOWS_SETTINGS_SECURITY_CHECKS=PASS.

Only then use backend/scripts/rollout_account_security.py: default read-only
preflight, reviewed Supabase project URL guard, source head0007 and database
revision0006/0007. --apply upgrades0006→0007 and confirms its revision/columns.
It never prints the URL/password or raw driver exception. No new cloud key needed.
Deploy matching app promptly after migration: the old app readiness will report
out-of-date between migration and matching deployment. Check the exact new host.

Keep historical deployment URLs protected; do not expose an older public backend
that lacks revocation enforcement. The production/custom-domain aliases must
target the new backend. A cached old frontend still uses the current same-origin
backend. Access to deployment protection is distinct from application sign-in.

Live acceptance uses a verified test account first: wrong password leaves session
working; new password works/old password fails; two independent browser sessions
are rejected after revocation; new login preserves verification/name/work; limits
behave; profile/themes/data/notebook SQL+Python/dashboard layout regressions pass.
After acceptance: record actual evidence, scoped commit/push, full checkpoint and
independent actual ZIP/manifest/Git comparison before phase completion.

## Rollback

Scoped byte-verified rollback is for LOCAL PRE-CLOUD use only and requires the
explicit -BeforeCloudRollout switch. It restores old bytes/removes only new files,
refuses later edits and changes no database or deployment. Once production uses
session revocation, retain BOTH migration0007 and its backend version checks.
Deploying the old backend or dropping session_version can resurrect revoked
cookies. Prefer fixing forward; a UI-only rollback can retain the new backend.
Migration downgrade tests run only in disposable databases, not Supabase.
Mandatory email verification, secure cookies and CSRF remain required.

Guidance consulted: OWASP Authentication Cheat Sheet (current-password
reauthentication, throttling), OWASP Session Management Cheat Sheet (revocation),
and SQLAlchemy ORM populate_existing/with_for_update documentation.

## Actual Windows and production acceptance — 17 October 2026

User supplied WINDOWS_SETTINGS_SECURITY_CHECKS=PASS with all cloud build/API,
self-hosted Python, branding and unchanged-input markers. The final Windows marker
requires the full native PostgreSQL/backend and frontend/lint/build checks to pass;
raw Windows test totals were not supplied and are not inferred from local runs.

Preflight SQL returned20261016_0006. The production rollout used instructions for
transactional SQL equivalent to migration0007: three columns, two constraints and
an expected-prior-revision guard before updating Alembic. The direct resulting SQL
revision was not pasted. Matching deployed source readiness validates database and
migration compatibility; successful live Security also validates its new columns.
The earlier guarded Python helper remains an alternative, not the executed route.
No database password or Secret export was needed. No new environment variables.

Deployment: dataplatform-v1-9gr1cbouj-deepanshu1927.vercel.app
Inspect: https://vercel.com/deepanshu1927/dataplatform-v1/G5gKKy73cjfnSTLAZpuBKkbxLXuQ
User reported /health/live200 and /health/ready200, databaseok/migrationsok.
Initial Vercel Not authorized resolved after account/project checks and one retry;
its cause is unproven. Git identity and history were not changed as a workaround.

User-reported PASS using a verified test account and independent normal/private
browser sessions: wrong current password rejected without logout; password change
returns to login; private-window old session blocked on refresh; old password
rejected; new password works and account remains verified. Sign out everywhere
returns to login, revokes the independent private-window session and preserves the
current password. These checks are actual user live evidence, not synthetic API QA.

Original verified-account regressions all PASS: account remains verified; dataset
preview; notebook SQL and Python; dashboard charts and saved layout; profile name
and theme. Durable-limit/concurrency cases belong to the accepted Windows/native
suite; no additional manual live rate-limit test is claimed.

Release uses exactly30 reviewed phase files; the unrelated untracked
`docs/DataPlatform_Settings_Security_Phase_Plan.md` stays outside the commit and
checkpoint. Complete checkpoint contains331 committed source files plus generated
user-verification evidence and a source SHA256 manifest. No Vercel/database command
is part of the finalizer. The external archive verification must still be completed.
