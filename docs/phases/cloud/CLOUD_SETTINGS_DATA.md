# Settings Data — workspace export and privacy contact

Candidate, based on independently accepted recovery commit
6eddf32581536b053a981e1604f289992e5ac2a0 / tree
aad44c82f6d42e0ceb480ccd6a1499ca1ad6aa98, actual full checkpoint
cloud-password-recovery-accepted-20261017-231542-a39f9c8e.zip, SHA256
8A17DF5CBB19B0CA8E792EE60458439246A5CE84B475C4074520DAFC51E8523E.
User chose recovery then Data/privacy; Notifications deferred.

## Frozen scope and connections

Replace Settings Data placeholders with actual numbered JSON workspace exports,
separate original private cloud CSV downloads, and confirmed operator/contact plus
accurate current-control information. Operator confirmed personally Deepanshu Singh;
public monitored privacy inbox confirmed deepanshu1927@outlook.com. No email is sent
by this feature; privacy contact is a mailto link the user chooses to open.

POST /api/v1/account-data/authorize uses the existing strict current-password schema,
locks/refreshes the authenticated User and rechecks active/verification/current
session_version. Shared durable Security window: five submitted password attempts
per15minutes across Change password, global signout and export confirmations.
Wrong passwords consume an attempt. Successful export confirmation does NOT change
password/session_version/verification or owned work. Distinct audience/purpose/
user/version-bound15min JWT export proof, held only in component memory, is required
in addition to the normal live cookie/verification/owner checks for every endpoint.
An access cookie is not accepted as an export proof or vice versa. Reset/global
revocation invalidate older proof/cookies on subsequent protected requests.

POST catalog uses25-item keyset pages and selects small metadata fields, not many
large notebook/layout values. POST record copies one owned saved item at its
catalog revision and serializes an allowlisted JSON document.384KiB raw fragments
are base64-delivered far below the3MiB app middleware limit, with total byte count,
revision checks and SHA256. Client validates offsets/size/hash and assembles whole
records into numbered JSON parts targeting4MiB and capped25items; one whole record may exceed the
target.32MiB/item bound gives explicit error/contact path; no silent truncation or
false complete download. Each part includes format/version, shared start timestamp,
account details, inventory, preparation time and final-part flag. Download filenames
share an export timestamp so parts from separate runs can be distinguished.

Include safe account/profile/verification details, owned dataset metadata/schema,
complete saved notebook content/outputs, dashboard definitions/layout and allowlisted
upload records. Exclude generic dataset config, server paths, storage locators,
connection credentials and server-managed password/session/verification/recovery
secrets. Do not execute saved SQL/Python/dashboard queries. User-authored saved code
may itself contain sensitive data: downloads are private copies for the owner.

This is NOT an atomic whole-database snapshot. Records are read at their versions;
changes/disappearance during an item read cause an explicit retry/restart error.
Save/avoid edits during export. Client cursor advances only after successful part
preparation, survives retries and re-confirmation, and is discarded on account
switch/unmount. Preparing one part at a time bounds memory and avoids uncontrolled
multiple downloads. A final part can contain zero records when all previous items
filled the preceding part. Every part is valid independent JSON.

POST dataset-file reuses strict original owner-key/bucket validation and existing
Supabase signed download implementation,60seconds. Browser fetches original bytes
directly from storage without cookies/proof headers/referrer or redirects, enforces
the permitted byte limit, then starts a local Blob download. This is not the
10,000-row browser Python snapshot. Missing/local-only/external sources have explicit
limitations. No public bucket, proxy of a50MB file through a Function, or durable
signed URL in the export. Already-authorized downloads can finish before expiry.

Strict extra-forbid schemas accept no caller-selected user/storage locator; new
validation errors use fixed no-store copy instead of echoing passwords/proofs.
Success and HTTP errors on export routes have no-store. Existing Origin/CSRF,
cookie/version/mandatory verification and API interceptors stay effective.

Settings retains theme tokens/branding/profile drafts; Data/Security operations
disable concurrent tab actions. Cancellation/latest-request checks stop stale
downloads, clear passwords, release object URLs and prevent account-switch replies
from appearing in a new user's UI. No browser persistent export credentials.

## Privacy boundaries

The panel names the confirmed operator/contact and current cloud services, lists
available controls and browser-only theme storage, and offers a real privacy-request
email link. It explicitly does not promise automatic retention, account deletion,
provider-log/backup export, immediate erasure or a complete legal privacy notice.
Data portability is not a complete subject-access/compliance process. Actual
retention, deletion lifecycle, contracts/transfers and full privacy notice require
further fact-based work. No consent switch that fails to affect processing is added.

## Validation and acceptance

Focused backend148PASS; six NEW native PostgreSQL cases skipped in this agent
runtime and mandatory in guarded Windows Docker verifier: real-cookie/owner and
large-record roundtrip, concurrent durable attempt cap, revocation, edited-item
conflict, pagination and unverified-account gate. No local native result is claimed.
Full frontend226tests/36filesPASS after a final25items/part cap added to bound
many-small-record exports; pagination/continuation is explicitly tested. TypeScript/cloud
build/API graph/self-hosted Python/sanitizer/branding PASS; lint0errors/9preexisting
warnings.335 unchanged tracked source guards include all migrations/head0008, old
security/recovery/verification services, execution/driver/config/manifests/assets.

Browser QA uses the production cloud build with synthetic APIs, not live/native
evidence. Desktop1440light/dark, mobile390light/320dark; valid downloaded JSON,
no horizontal overflow/secret browser storage/page errors. Headless browser web
security remains enabled; same-origin POST Origin checked. Internal screenshots
reviewed and not delivered. Actual Windows verifier, cloud/live acceptance,
scoped Git publication and full checkpoint audit remain PENDING.

No migration, dependency/environment/provider/hosting change; accepted head0008
retained. No user PC source, production database/cloud or GitHub change by agent.

## Rollback

Before cloud rollout use exact byte-guarded backups and explicit pre-cloud rollback;
refuse later edits or linked paths. No automatic database downgrade. After deployment
retain accepted0007/0008 security/recovery enforcement and prefer fixing forward or
reviewed UI-only rollback. No deletion/cleanup commands are run by this phase.
Downloaded copies already saved by a user cannot be recalled by the app.


## Accepted Windows and production evidence — 18 October 2026

This release record supersedes candidate/pending rollout statements above.
Application code is unchanged from the deployed candidate. Two tests were
corrected before the final Windows verification; only these two phase documents
are updated during release closure. No new deployment or migration is required.

The actual initial full Windows backend output was 432 passed, one failed. The
single native roundtrip test supplied users/{owner}/source.csv, which the existing
owner storage validator correctly rejected before a mocked provider call. The
test fixture now uses the existing build_dataset_object_key generator; the
application validator was not changed. Three focused regression cases verify a
valid generated key and rejection of an invalid filename and another owner's key
before storage access. All34 account-data unit tests pass locally.

User ran the checksum-checked REPAIR-AND-VERIFY-SETTINGS-DATA.ps1, SHA256
954beac2d5a0feeacc5dc354456eb8444d0958b9eb905ea1eab519dd9091435d.
It guards all353source blobs, corrects only two tests, reruns the failed native
case and three new regression cases, and validates JUnit all4pass/zero skips.
It then runs the full frontend suite, lint, cloud build, branding and unchanged
source/input guards. User supplied WINDOWS_SETTINGS_DATA_CHECKS=PASS plus
CLOUD_FRONTEND_BUILD=PASS, CLOUD_API_BASE=/api/v1, SELF_HOSTED_PYTHON_ASSETS=PASS,
CLOUD_BRAND_ASSETS=PASS, BUILD_INPUT_FILES_UNCHANGED=PASS. Verification record:
D:\New project\databricks-clone-v1\checkpoints\cloud-settings-data-checks-20261018-000427-5705a98a\RESULTS.json.
The432previously passing backend cases were not needlessly rerun. Do not describe
this as a single new full-suite436pass run; the evidence combines two guarded runs.
Raw final Windows frontend totals were not supplied and are not inferred.

Production deployment: dataplatform-v1-q3jkjnq4h-deepanshu1927.vercel.app.
Inspect: https://vercel.com/deepanshu1927/dataplatform-v1/4qVvskj2592yGJuni2qMLKbJYcQb
Browser origin: https://dataplatform.sprout-sql.com.
Both exact-new-host health endpoints returned HTTP200: alive and ready with
database=ok/migrations=ok. Accepted migration0008 is retained; no Data migration.

User production acceptance: wrong export password rejected while signed in;
correct password accepted without logout; every numbered JSON part downloaded
through final; own profile and expected saved work found. Original private cloud
CSV177bytes matches source SHA256. A generated25,000row original CSV4652820bytes
was uploaded and downloaded through SettingsData, and full-source versus download
SHA256 matches with both lengths4652820. Entering the two hash paths in reverse
order does not affect equality. No Python snapshot was substituted.

Privacy panel operator/contact, Light/Dark/narrow-window Data readability, original
dataset preview, notebookSQL+Python, dashboard charts/saved layout and saved name/
theme all user-reported PASS. Cancellation/retry, stale account replies, proof
revocation/isolation/rates are covered by automated candidate/native tests; do not
invent additional manual production results for them.

Release helper stages exactly18reviewed paths, performs a non-force Git push and
exports all353trackedsource files, with user evidence and a source manifest. It
ignores untracked downloaded plans/helpers and excludes credentials, private env,
dependencies, local data and backups. Actual Git commit/push and uploaded full ZIP
still require independent confirmation. No Vercel, database, email or application
test command is part of this closure. Full privacy notice/retention/deletion remain
separately scoped; this export/contact phase is not blanket GDPR compliance.
