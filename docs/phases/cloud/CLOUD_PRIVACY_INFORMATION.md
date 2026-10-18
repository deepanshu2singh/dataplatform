# Cloud privacy information — accepted Windows/live checks

19 October 2026, Europe/London. Windows verification and the reported production
acceptance passed; scoped Git publication/full checkpoint are performed separately
by the guarded release helper. Independent audit of the actual resulting checkpoint
remains pending. This is a completed transparency/browser-preference phase, not
completion of retention jobs, age assurance, account deletion or GDPR compliance.

User-reported live deployment: dataplatform-v1-4ac6crmnj-deepanshu1927.vercel.app.
Both /health/live and /health/ready HTTP200; ready database/migrations ok. Public
/privacy accessible without app sign-in, UK operator/contact accurate, current
cleanup limitations visible, Light/Dark/narrow readable. Remember/forget and two-tab
refresh behavior passed. Settings control and sidebar new-tab draft preservation
passed. Dataset preview, SQL/Python notebook, dashboard layout/charts and Settings
Data export controls passed. No new full CSV/export byte equality test is inferred.
Unverified-account access is automated-test coverage, not separately claimed live.

Windows marker WINDOWS_PRIVACY_INFORMATION_CHECKS=PASS; record:
D:\New project\databricks-clone-v1\checkpoints\cloud-privacy-information-checks-20261018-233316-b7f31aec\RESULTS.json.
Raw Windows test totals were not supplied. Preparation environment did record110
focused tests/15files, lint, types/cloud build and asset checks PASS for this payload.
Source inputs unchanged during Windows checks. No production migration was needed;
last accepted database revision remains20261017_0008; health reports migration ok.

Initial installer failed at File.Replace's null-string argument in Windows
PowerShell. Corrected Apply and Rollback use explicit NullString.Value and run a
same-volume disposable write probe. Corrected package SHA256:
eeb912aefb56d6b05f1306745937af5bce68f60158866f8e9861d2ce726e4da9.
All25payloadfiles stayed byte-identical during the installer correction. Old/new
rollback folders remain valuable; use the corrected rollback helper for old records.
No credentials, Vercel configuration or database troubleshooting was needed.

The release helper changes only this record and its validation JSON, verifies the
entire expected364-file source tree and25-file scope, checks the reported Windows
record, stages explicit paths, validates the exact Git tree, makes one normal commit,
then pushes without force. Reruns can resume an identical locally committed release.
It builds a full tracked-source checkpoint with hashes and Git/user evidence. It
excludes untracked downloads, private env, exports, dependencies and rollback data.
It does not deploy, migrate, send email or delete data. A documentation-only release
update does not require a new app deployment. Upload actual checkpoint for audit.

---

Historical preparation/design evidence below; its pending Windows/live statements
are superseded by the accepted evidence above. Its design limits remain applicable.

# Cloud privacy information —18 October2026

Status: scoped patch prepared against accepted commit
c3db1b1e413f41b7bb4829645e98c81365bc694c, database20261017_0008.
No migration, deployment, Git publication or cloud cleanup is part of this package.
Operator confirmed United Kingdom on18October2026; name and monitored inbox remain
Deepanshu Singh / deepanshu1927@outlook.com.

## Scope and actual behavior

Adds public /privacy outside sign-in/verification redirects, and new-tab links in
login, registration, email verification, recovery, workspace sidebar, Settings Data
and dataset upload guidance. New tabs preserve private forms and drafts. The page
contains no account-specific values and stays readable if authentication fails.

Adds an actual remember/forget appearance control in Settings Appearance and the
public notice. Existing valid saved choices remain readable and continue to save.
Without a saved choice, selection stays in memory until remembering is chosen.
Forgetting removes only dataplatform-theme, keeps the current view and prevents
future writes; reload then follows System. System is not itself an opt-out.
Removal/save failures are explicit and retryable; forgetting stops writes even
if browser policy prevents erasing an older key. Cross-tab removal preserves the
current appearance and does not recreate the saved key. No other storage is cleared.

The existing theme bootstrap is unchanged. Dependencies, API base, self-hosted
Python, authentication, CSRF, sessions, verification, recovery, export/upload logic,
backend files, migrations and Vercel configuration are unchanged. AccountData copy
now correctly distinguishes saved notebook content from transient visible outputs.

## Operator review before deploying this notice

Read PRIVACY_NOTICE_REVIEW.txt in the package and the actual app notice. Confirm
that the declared purposes/provider arrangements remain true. Publication is a
normal explicit operator deployment step; no helper publishes the legal wording.
This patch is transparency/browser-choice work, not a full GDPR certification.

The agreed retention direction is NOT implemented by this patch: inactivity12months
plus30day notice; never-verified/no-ever-owned-work signup30days; abandoned bytes24h
after actual capability expiry/grace; expired code-secret cleanup24h; resolved
privacy correspondence12months; validated live-system account cleanup target7days.
The public page describes current manual contact/item/export controls and explicitly
says scheduled purges/self-service account deletion are not yet running. The
operator can adopt the correspondence-handling routine now. No blind user SQL,
claim of all-provider7day erasure or automatic destruction of existing work.

Minimum16+ and sensitive/criminal-data exclusion are published use rules in this
package. They are NOT independently verified age, API age attestation, a content
scanner, or a completed children-risk/age-assurance implementation. The next work
must address proportionate age assurance, actual customer processing arrangements,
children's privacy risk assessment and durable deletion/retention. A privacy notice
is not automatically an Article28 processing agreement. No date-of-birth/identity
collection, historical consent/age backfill or marketing consent was introduced.

## Limited legitimate-interests assessment for operator-determined processing

Prepared for operator review with this release. Scope: account administration,
free-service operation, proportionate troubleshooting and abuse/security controls.
It does not choose a customer's basis for processing an uploaded dataset.

Purpose: enable the analytics workspace the person requests and protect the
person's access and saved work. It is not a purpose for ads, research/demo reuse,
sale or model training of uploads. Necessity: verified email binds/recover accounts;
password hash/session state and bounded attempt windows protect access; optional
name is not required; source files and selected saved code/definitions enable the
requested analysis. Do not collect additional identifiers merely for convenience.

Balance: users expect private saved analytics, not unrelated observation. Impact
can be material if personal CSVs are exposed, including people aged16–17 and people
in another user's upload. Existing safeguards include owner-scoped access,
mandatory verification, secure cookies, password confirmation for sensitive account
actions, session revocation, redacted app logs, private storage and no identified
visitor-analytics SDK. This release adds a clear notice, separate objection route
and meaningful appearance storage choice. Retention and age/processor-arrangement
gaps remain; they are not waived by this assessment or by a checkbox. Handle
objections/requests proportionately, limit support access and correspondence,
review provider terms and complete appropriate children's/DPIA assessment before
expanding processing or making a blanket compliance claim. Refresh this record
when purposes, providers, data categories, audience or controls materially change.

Privacy-request processing uses the applicable legal obligation where one requires
it; an operator may not label every support purpose a legal obligation. Do not
assume a valid service contract or universal consent basis from signup alone.

## Source/provider evidence

Accepted user facts: public/free now, paid later, worldwide,16+, ordinary authorised
personal data, sensitive/criminal data excluded, workspace-only upload use. Supabase
Free/London/private bucket/Data API OFF; dashboard backups/PITR unavailable. No
separate live DB copy downloaded; test exports described as test data. Vercel Hobby
Analytics/Speed Insights show setup/no data; Drains requires Pro and lists none.
Resend3,000emails/$0, verified notify.sprout-sql.com, Ireland sending, no webhooks.
Tracking checkbox was in a NEW setup wizard, not proof of an active saved setting.

Supabase standard Terms incorporate a DPA and restrict HIPAA PHI without a BAA and
payment-cardholder data without prior written approval; no special approval is
established. Ordinary sales/amount data is not automatically payment-cardholder
data. Resend stores email data in the US even for EU sending, with standard Free
email/log30day retention and separate backup/other exceptions. Database backups do
not include Storage file bytes. Public standard DPAs are not proof that every
custom agreement/optional feature/transfer risk has been audited; Outlook mailbox
arrangements and customer processing terms remain their own assessment items.

Primary sources reviewed18October2026:
- https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/the-right-to-be-informed/what-privacy-information-should-we-provide/
- https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/a-guide-to-lawful-basis/legitimate-interests/
- https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/children-and-the-uk-gdpr/
- https://supabase.com/terms
- https://supabase.com/legal/customer-resources/data-processing-addendum
- https://vercel.com/legal/dpa
- https://resend.com/security/gdpr
- https://resend.com/docs/dashboard/domains/tracking

## Validation and rollout

See CLOUD_PRIVACY_INFORMATION_VALIDATION.json for actual native evidence. Windows
PowerShell5.1 checks and live visual checks remain pending until the operator runs
them. No local PowerShell runtime/browser render is claimed. The cloud-browser
preview timed out before rendering; temporary work then reset and was reconstructed
from the accepted source. The deliverable was rechecked after reconstruction.

Apply only with the package's source/branch/HEAD/hash guards, then run
scripts/verify-cloud-privacy-information.ps1. It exercises affected frontend flows,
lint, types/cloud build and branding, and ensures tracked/phase inputs are unchanged.
No Docker/backend suite is needed for this frontend-only patch. On success share
the final output. Review the notice before any separate production deployment.

Live acceptance after deployment: /privacy signed out, verified and unverified;
all notice links open a separate tab and keep drafts; readable Light/Dark/narrow;
remember on survives reload; remember off keeps immediate appearance and does not
recreate preference on reload; existing profile/export/upload/notebook/dashboard
flows remain functional. Keep this an observation checklist, not a fabricated PASS.

Rollback: the apply helper backs up original bytes and lists precisely introduced
files. The rollback helper refuses edited/unknown current files, restores only this
scope and never changes DB/cloud data. It cannot reverse a deletion—this package
performs none. After accepted live checks, use a scoped Git release and full clean
checkpoint with independent verification; do not commit exports, .env files or
package/rollback ZIPs.
