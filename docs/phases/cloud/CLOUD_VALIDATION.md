# Cloud integration validation record

11 October 2026. The source is prepared; Docker and live acceptance are pending.

## Performed here

| Check | Result | Practical limit |
|---|---|---|
| Frozen checkpoint integrity | Exact final ZIP SHA-256; all 206 original manifest files verified | Historical runtime evidence is not repeated acceptance |
| Current-source reconstruction | Seven cloud files plus three storage files reconciled; 206 clean input files hashed | Git branch/HEAD come from the user's console, not a local Git clone |
| Existing config/storage foundation before edits | 27 passed | HTTP mock transport; no live credentials |
| Focused backend after implementation | 90 passed | Python 3.12, pinned dependencies and pytest 8.3.5; Docker uses 3.11 |
| Frontend suite | 104 passed | Vitest/jsdom and mocked transport; no real browser TUS/CORS |
| Frontend lint | Exit 0, existing React warnings | Warnings retained; no claim of zero warnings |
| Frontend TypeScript/Vite build | Exit 0, existing large-chunk warnings | Build success does not establish deployed bundle/runtime limits |
| Alembic graph | Single head `20261011_0005` | No database connected |
| New migration DDL | Offline PostgreSQL upgrade/downgrade SQL test passed | No live PostgreSQL execution or ORM-diff check here |

The 90 backend checks cover signed upload configuration, masked storage errors,
signed read origin/path/expiry, partial-download cleanup on cancellation,
owner-scoped object resolution, temporary reader lifetime, actual restricted
DuckDB execution from a downloaded CSV, upload completion replay, invalid/expired
input, storage preservation on commit failure, snapshot row/byte/hash limits,
cancel/expiry selection, existing SQL restrictions and delete transaction
ordering, response-size boundaries, CORS/request ID preservation, readiness and
existing error behavior. Mock sessions prove code paths, not PostgreSQL locking.

Exact backend command, from `backend`:

```text
python -m pytest -q tests/test_config_security.py tests/test_cloud_storage_config.py tests/test_storage_service.py tests/test_sql_validation.py tests/test_dataset_delete_transaction.py tests/test_domain_logging.py tests/test_health.py tests/test_error_handling.py tests/test_health_readiness.py tests/test_cloud_dataset_flow.py tests/test_cloud_storage_extensions.py tests/test_cloud_response_limit.py tests/test_cloud_upload_migration_sql.py
```

Frontend commands: `npm ci --ignore-scripts --no-audit --no-fund`, `npm test`,
`npm run lint`, `npm run build`. Build warnings concern the existing Monaco and
notebook chunks. No new frontend package changes were needed beyond the user's
supplied current TUS dependency.

## Not performed here

- Windows execution of guarded apply/rollback scripts. Review plus checksum
  simulation is not a PowerShell runtime test.
- Full Docker/Python 3.11 backend suite, fresh PostgreSQL migration, Alembic
  metadata diff and live downgrade on an isolated disposable database.
- Two new real-PostgreSQL worker-race tests in `test_migrations.py`: competing
  completions and completion versus cancellation with independent sessions.
  They use mocked object transport but actual PostgreSQL locks. They were added
  for the Docker gate and are not reported as passed here.
- Actual browser upload/resume, Storage CORS, Secure-cookie/CSRF behavior on
  Vercel, cloud readiness, host body/resource/bundle limits and signed snapshot
  download from the real private bucket.
- Supabase migration, storage cleanup, deployment, Git commit or push.

This environment has neither Docker nor PostgreSQL. The existing test Compose
stack is the next reproducible gate. Follow CLOUD_INTEGRATION_RUNBOOK.md and
retain errors for diagnosis before any live rollout.

The historical `FINAL_V1_STATUS.txt` remains historical. This document describes
the new cloud source snapshot and must not be interpreted as final project
completion.
