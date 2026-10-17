# Settings: profile and appearance

Baseline: accepted actual cloud-email-accepted-20261016-224548-2244f05c.zip,
SHA25663ec597b6f4407d348e07092b97c554e4135c564429050caf6147af71eaa84e5,
branchcloud-deploy-v1, commitd18e037f4a7e1790f5ad4e1b8f21f168ec9e2ac6.

## Scope and connections

Settings Profile edits only the optional full name. PATCH /api/v1/auth/me uses
get_current_active_user: a signed-in active, verified account is required when
mandatory verification is enabled. The schema explicitly forbids extra fields;
email, password, active/superuser and verification fields cannot be changed.
Names are trimmed, blank becomesNULL,255Unicode characters maximum, single line
with no control/surrogate characters. The existing users.full_name column is used.
There is NO new schema migration, dependency, cloud key or auth-provider change.
Migration head stays20261016_0006, with mandatory email verification preserved.

Payload requires full_name and expected_full_name. The backend compares and updates
atomically for the authenticated user's ID only. A stale, different name gets409;
a retry of an already-saved target succeeds without a second logical change.
The frontend preserves the draft on failure/conflict and updates shared AuthContext
from the saved server identity. The sidebar and account summary refresh together.
Late responses cannot restore a logged-out session. The existing unsaved-work
guard protects navigation/logout/reload; switching Settings tabs retains the draft.

Appearance cards use the existing ThemeProvider preference and storage key. The
header and Settings stay synchronized, including System/media changes. This is a
browser-local preference, not a newly introduced account/database setting. Existing
storage-unavailable behavior retains the choice only for the current session.
Email verified status comes from the existing backend flag. Email address stays
read-only. Unsupported Security/Notifications/Data capabilities remain explanatory
cards; no fake saves, password changes, MFA, export, deletion or retention controls.
Scoped Settings CSS uses existing theme tokens and reduced-motion support.

## Necessary build-check adjustment

The new Settings imports make Vite move the same-origin API configuration into a
statically imported shared chunk. The previous check assumed the literal lived
inside index.js and falsely failed an otherwise correct build. The build wrapper
now uses build/verifyCloudApiBundle.mjs to inspect the actual static bootstrap
import/export graph, safely bounded to emitted assets. It still requires /api/v1
and rejects the local-development API URL, including in shared chunks. Dynamic or
unreferenced chunks cannot satisfy the API requirement. Five fixture tests cover
entry/shared/cyclic modules, local URLs, dynamic-only/unreferenced configuration
and escaping paths. Build commands, Vite config, manifests, lockfile and dependencies
are unchanged; only post-build verification follows the emitted module graph.

## Acceptance and rollout

Windows and live acceptance passed, as reported by the user on 17 October 2026
(Europe/London). The final WINDOWS_SETTINGS_PROFILE_CHECKS=PASS marker confirms
the guarded full disposable native PostgreSQL/backend suite, frontend suite, lint,
cloud build, API/Python/branding and unchanged-input checks completed. No raw
Windows backend test total was supplied; do not invent a count.

Tested production deployment:
https://dataplatform-v1-fw96mewoo-deepanshu1927.vercel.app
Inspect: https://vercel.com/deepanshu1927/dataplatform-v1/7pzmurYoKXR5mKRkBPYHtfE5thKb
Browser origin: https://dataplatform.sprout-sql.com
Both /health/live and /health/ready returned HTTP200; database and migrations ok.
No migration or new environment value was required; database head stays0006.

The user confirmed name save/sidebar updates, persistence after refresh and a new
login, read-only email/verified badge, Light/Dark/System and theme persistence.
They also confirmed drafts survive Settings tab switches, navigation warnings and
Discard work, two-tab conflicts preserve the losing draft, and refresh shows the
saved name. Existing dataset preview, notebook SQL and Python, and dashboard
charts/layout passed the live regression checks.

These are user-reported live results, distinct from the earlier automated and
synthetic browser evidence. Narrow-screen and keyboard behavior, other-account
isolation, exact API semantics and late save-after-logout cancellation are covered
by automated verification, not newly claimed as separate live manual checks.
The prior mandatory email gate is unchanged and remains required.

Release closure: guard and commit only the exact 17-file Settings scope, changing
only these two evidence documents from the tested patch; push to cloud-deploy-v1
and confirm the remote commit. Capture all319tracked source files plus generated
user evidence and a SHA256 manifest. Independently inspect the actual returned ZIP
against its manifest and Git commit before declaring checkpoint/archive completion.
The release helper does not deploy, migrate or change cloud configuration.

## Rollback

Apply creates byte-verified originals under checkpoints/cloud-settings-profile-rollback-*.
The scoped rollback restores only guarded phase files, refuses later edits and does
not alter Git history, the database, environment variables or cloud objects. No
schema change occurs; previously saved names remain in users.full_name. If already
deployed, source rollback requires a matching redeployment; retain migration0006
and mandatory email verification. Do not disable the email gate to roll back styling.
