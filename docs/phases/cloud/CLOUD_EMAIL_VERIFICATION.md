# Email ownership verification

Source baseline: accepted branding checkpoint at commit
6ee1de527c05e21db776f742e37726446e49432c, 299 manifest files / 298 tracked sources.
User selected mandatory verification for existing and new accounts.

Resend sender notify.sprout-sql.com was shown Verified in the user's screenshot
16 October 2026, provider Vercel, region Ireland. The private sending key was subsequently configured in Vercel; real delivery and
account verification were confirmed by the user on 16 October 2026.
From address: no-reply@notify.sprout-sql.com; display name Data Platform.

## Behavior

An unverified account can establish the existing HttpOnly-cookie session and use
only account identity, verification and logout endpoints when enforcement is on.
Every workspace API continues through the shared database-backed verified-account
dependency. An older cookie cannot bypass that dependency. Inactive accounts
remain blocked. No Supabase Auth or bearer-token migration is introduced.

The branded /verify-email page supports email-code autofill, keyboard entry,
leading zeros, light/dark styling, mobile widths, errors, resend cooldown and logout.
There is no automatic email on mount/refresh, limiting accidental quota use.
The page explicitly sends an email only when the user requests a code.

Codes have eight cryptographically random decimal digits, expire after 10 minutes,
and are bound to the authenticated user, stored email and random challenge nonce.
Only an HMAC-SHA256 digest is stored. Five wrong attempts invalidate the challenge.
Resend replaces the previous challenge; at least60seconds between sends, five
sends/account/hour, ten sends globally/minute and90globally/day are enforced in
PostgreSQL. Global counter keys are bounded to two rows. These are delivery-abuse
controls, not a claim that all authentication abuse/MFA/password-recovery is solved.

User-row and global-budget locks end before external HTTP delivery. Reservations
are committed first; failed or uncertain delivery still consumes a reservation.
A code remains usable after an uncertain HTTP timeout if the email does arrive.
Provider bodies, codes and API keys are never logged/returned to the browser.
Only the existing httpx dependency is used; outbound redirects are disabled.

## Database and rollout

Migration20261016_0006 adds nullable verification/challenge timestamps and digests,
bounded attempt counters, and email_delivery_limits. Existing user IDs, hashes,
active flags and owned content remain. Existing users are NOT marked verified.

EMAIL_VERIFICATION_REQUIRED defaults false solely for a controlled delivery
preflight. This mode retains the old workspace access policy. It is not the final
security state. After real sender delivery and the owner's verification succeed,
set it true on every environment serving this database and redeploy. Required=true
fails configuration validation if RESEND_API_KEY or EMAIL_FROM is missing.

RESEND_API_KEY is server-side SecretStr. EMAIL_FROM is the bare email address,
not the display-name form. Do not create VITE_ variants, log keys, put them in Git,
or paste them in chat. Sender selection is fixed server-side; the browser cannot
supply the recipient. Supabase Data API/RLS/grants and private storage are unchanged.

Readiness requires exact migration-head equality. Applying0006 while the old0005
deployment remains active temporarily reports migrations out_of_date. Coordinate
the new deployment immediately after migration; this is a known transition, not
an authentication/password diagnosis. Do not blindly roll back old source after
migrating: its readiness head is older.

## Verification

Windows verifier checks the fixed disposable Docker test database, builds/migrates
the test API and runs the complete backend suite, including verification API,
expiry, attempts, resend, budgets and independent-session races. It also runs the
frontend suite, lint, the existing cloud wrapper, sanitizer and branding checks.
Core requirements, lockfiles, Dockerfiles, build configuration and Vercel config
are unchanged and hashed before/after. No cloud DB migration or deploy is run.

Agent-local checks and their limits are recorded in the companion validation JSON.
The user supplied WINDOWS_EMAIL_VERIFICATION_CHECKS=PASS after the complete
guarded Windows verifier. Real delivery, mandatory UI/API gating, original data
retention and verification persistence were confirmed. Final dataset/notebook/
dashboard regression checks are explicitly confirmed by the operator before the
release helper writes this record. No raw Windows backend total was supplied.

## Rollback

Before cloud migration, use the scoped backup's ROLLBACK-CLOUD-EMAIL-VERIFICATION.ps1
to restore only guarded payload files; it refuses later edits.
After cloud migration/deployment, retain the new source/migration head and, for
an operational emergency, temporarily set EMAIL_VERIFICATION_REQUIRED=false and
redeploy. This explicitly reopens unverified workspace access until fixed; it is
not a completed secure rollout. Avoid a destructive production downgrade or
deleting user rows. Re-enable after fixing delivery/configuration.

Existing deployment protection stays in place. Preview environments sharing the
production database need the same final enforcement configuration; do not expose
older protected deployments as a route around the current application policy.

## Accepted live rollout: 16 October 2026

- Private Supabase session-pooler preflight passed at revision20261011_0005.
- Additive migration20261016_0006 applied and resulting revision confirmed.
- Delivery preflight deployment: dataplatform-v1-2puoxdcmu-deepanshu1927.vercel.app;
  both health endpoints200, real owner delivery/code/refresh passed.
- Mandatory-verification deployment: dataplatform-v1-eovcilz9p-deepanshu1927.vercel.app;
  both health endpoints200; readiness database and migrations both ok.
- Browser origin: https://dataplatform.sprout-sql.com.
- Original verified account retains its work. New account is blocked at both home
  and datasets API until it verifies; verification survives sign out and sign in.
- Wrong-code, expiry, resend, quota and concurrency coverage is automated; these
  are not separately claimed as live manual abuse tests.
- The release helper writes final feature regression evidence only after the
  operator explicitly confirms dataset preview, notebook SQL/Python and dashboard
  charts/layout. The helper does not run a cloud migration or Vercel deployment.

This proves access to the registered email inbox. It does not establish a person's
legal identity or exclude every disposable email provider. Password recovery,
email-address changes and MFA remain separate future work.
