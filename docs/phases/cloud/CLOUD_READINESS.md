# Production readiness diagnostics

Prepared 12 October 2026 from the checksum-verified 230-file deployment source
checkpoint. The user applied the hosting patch and changed private Vercel settings;
no later application-source edit was reported. The apply guard checks the actual
Windows files before replacing them. This is a prepared source reference, not a
new user-machine capture or proof of hosted acceptance.

## Trigger and scope

The current protected deployment np6y830mt answers /health/live with 200 but
/health/ready with 503, database unavailable and migrations unknown. Supabase's
public schema was confirmed empty and all five existing migrations were applied
successfully; alembic current independently reports 20261011_0005 (head).
A local read-only Session pooler probe connected in 2.16 seconds. The old
readiness check allows two seconds. That timing is evidence that the budget is
too small for at least one valid external connection, not proof that it is the
sole cause of the Vercel failure.

Eight files: config.py, health.py, observability.py, their three focused test
files, this scope/runbook and CLOUD_READINESS_VALIDATION.json. Production receives
a bounded ten-second readiness budget; development and test keep two seconds.
No new hosting variable or dependency is required. A database ping and the shipped
Alembic head must still match before readiness becomes 200. Revision-read timeout
preserves database=ok and marks migrations=unavailable instead of misreporting the
database ping. The public response retains sanitized status and request ID only.

Internal health logs add a bounded exception-type chain, validated five-character
SQLSTATE and the budget. They never serialize exception messages, query parameters,
SQL statements, hosts, URLs or credentials. The JSON formatter validates the new
diagnostic shapes. Settings validation hides input values in rendered exceptions,
addressing the earlier short SECRET_KEY exposure; validation remains enforced.
Pydantic's programmatic errors() can still contain inputs: this setting protects
rendered startup errors, and does not authorize logging errors() or settings dumps.

## Local validation

40 focused tests passed / 2 existing deprecation warnings on clean Python 3.12
dependencies, covering slow Production connection, bounded timeouts, migration
failure attribution, wrapped driver codes, cycles/invalid fields, credential-free
logs/tracebacks, correlation/CORS/CSRF and signing-key/cookie constraints.
The first test process stopped during import because an existing scratch DuckDB
native library was truncated. The identical pinned 1.5.6 wheel restored that
test-only library, with full installed RECORD hash/size verification; no package
version, app requirements or shipped binary changed. The suite then passed.
No live database was available to these tests. User-side Supabase migration
evidence is separate from mocked readiness behavior. PowerShell runtime is not
available here; apply/rollback hash logic is additionally simulated in Python.

## Windows apply and check

1. Download DataPlatform_Cloud_Readiness_Patch.zip. Use the chat's checksum-checked
   selector; it validates the ZIP, extracts to a unique directory and passes that
   directory as PackageRoot. Do not overwrite the project with a full snapshot.
2. APPLY-CLOUD-READINESS.ps1 -VerifyOnly checks branch cloud-deploy-v1, unchanged
   HEAD 2443908c1a04a880fa92cd084ac260da3734f12d, current touched-file bytes and
   cross-component prerequisites. A mismatch stops without source changes.
3. Apply once; save the printed cloud-readiness-rollback folder. It contains
   changed-file originals and scoped rollback. Local Vercel links, .env files and
   the CLI's .gitignore addition are outside this patch and remain on the machine.
4. In D:\New project\databricks-clone-v1, with Docker Desktop running:

```powershell
docker compose -f .\docker-compose.test.yml run --build --rm --no-deps backend-tests python -m pytest -q tests/test_health.py tests/test_health_readiness.py tests/test_config_security.py tests/test_observability.py tests/test_observability_regression.py tests/test_log_redaction.py
```

This rebuilds the changed backend/test source and runs only the 40 scoped checks.
No PostgreSQL/test API service, migration or Supabase connection is started.
Share the test summary before deploying. Frontend/source dependencies are unchanged;
do not repeat frontend/full database suites for this patch without a new failure.

## Hosted verification

After Windows checks pass, deploy the current linked root using
`npx.cmd --yes vercel@63.1.2 deploy --prod --scope deepanshu1927`.
Keep Deployment Protection enabled and use the NEW returned deployment URL.
Read /health/live, then /health/ready with vercel curl, --scope deepanshu1927,
and curl flags after -- (silent/show-error/max-time 60/write-out HTTP status).
200 requires database=ok and migrations=ok; 503 is still a failure to diagnose.

If 503 persists, use pinned `vercel logs NEW_URL --scope deepanshu1927 --since 15m
--status-code 503 --limit 10 --expand`. Correlate the request ID and share the
safe health warning with exception_types/sqlstate/timeout_seconds. TimeoutError,
InvalidPasswordError/28P01, TLS/DNS errors and UndefinedTableError/42P01 identify
different next steps; do not change passwords, TLS or migrations speculatively.
The patch is not proof the saved Vercel connection matches the locally tested URI.
The application is not accepted until readiness and browser/private Storage,
SQL/widgets/Pyodide/ownership/delete checks pass. Existing npm audit details and
the intended custom-domain origin still need review before final acceptance.

## Rollback

Run the saved ROLLBACK-CLOUD-READINESS.ps1 with -VerifyOnly before restoring.
It refuses later edits and restores only these eight files. It performs no Git,
database, Storage or hosting action. If source is restored, a deliberate deployment
is required to change hosted code. Retain the already-applied database migrations;
no downgrade/reset or object deletion belongs to this source rollback.

## References

- https://docs.python.org/3.12/library/asyncio-task.html#asyncio.timeout
- https://docs.pydantic.dev/2.10/api/config/#pydantic.config.ConfigDict.hide_input_in_errors
- https://vercel.com/docs/cli/logs
