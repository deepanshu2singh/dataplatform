# Cloud dataset integration

## Input and scope

The input is the verified final V1 checkpoint (SHA-256
`7d1b1f85aba0c49de39d7699fd6156c3475b74e908b0c2b116ddf841efd0a530`)
overlaid with the seven current cloud files and three current storage files
provided on 11 October 2026. Dataset and dashboard extracts match the final
checkpoint. The reported branch is `cloud-deploy-v1`, HEAD
`2443908c1a04a880fa92cd084ac260da3734f12d`.

Configuration/storage foundation: the existing three relevant test files
passed 27/27 on Python 3.12, with the project's pinned direct dependencies.
This is local evidence, not a claim of a deployed cloud application.

This phase connects browser-direct private CSV uploads to every existing
dataset consumer. Local Docker uploads remain available. No paid service,
public bucket, backend Python executor, or new hosting provider is introduced.

## Files affected

- Backend configuration, storage adapter, dataset schemas/routes, SQL and
  dashboard execution wiring, model registry, migration-head test expectations, and a new upload-intent model
  and Alembic migration.
- New shared temporary-file and CSV snapshot helpers, cloud response-size
  guard, and upload-intent expiry cleanup command.
- Frontend dataset upload flow, a TUS helper, and browser-Python dataset bridge.
- Relevant backend/frontend tests, environment examples and phase runbook.

## Implementation contract

1. The backend creates an owner-scoped upload intent and a signed TUS token.
   Preparation and completion accept metadata, not file bytes.
2. Completion locks the intent row, verifies the private object's actual size
   and CSV content, and creates dataset metadata in the same transaction as
   marking the intent complete. Replays return the existing dataset.
3. Source objects stay immutable. A bounded, derived Python CSV snapshot is
   stored privately; browser Python obtains a short-lived signed read URL,
   preserving its 10,000-row/10 MiB limits without a large function response.
4. SQL, preview, widgets and schema fallback use one authorized, unique local
   temporary file. DuckDB external access restrictions remain unchanged.
   Cancellation waits for a thread reader to finish before file cleanup.
5. Dataset deletion commits metadata first, then cleans both source and derived
   objects. Pending/cancelled intents are cleaned after upload tokens expire.
6. Cloud upload capacity is capped at 50 MiB; API response delivery is bounded
   below Vercel's documented limit. Local capacity remains 100 MiB by default.

## Acceptance

- Existing configuration/storage tests pass; new storage error, cancellation,
  token and signed-download cases pass without leaking credentials.
- Valid cloud upload can be prepared, completed, replayed and queried.
- Invalid CSV, incorrect size, oversized object, incomplete upload, foreign
  upload/dataset and expired/cancelled intent are rejected safely.
- Concurrent completion/cancellation cannot create duplicate metadata or
  delete a completed dataset's object.
- Local upload, SQL restrictions, preview, widget execution, schema and bounded
  Python export keep their established behavior.
- Temporary files disappear on success, error and cancellation; database
  failure does not remove a live source object.
- Browser TUS flow, completion retry, dynamic limits and signed Python snapshot
  download are verified by focused frontend tests; lint and build pass.
- Migration upgrades the prior head, matches ORM metadata and downgrades its
  own new empty table in a disposable test database.
- Actual Supabase browser TUS/CORS, deployed cookies/routing, readiness and
  deployed response limits remain separate live acceptance checks.

## Rollback

Preserve the exact reconstructed input checkpoint and its file hashes before
application. Restore only scoped files if a check fails; preserve existing
working-tree edits. Do not reset Git or restore a production database dump.
The additive upload-intent migration can remain when reverting code. Never
downgrade a live database or delete uploaded objects as an automatic rollback.
Cloud-backed dataset records require cloud-capable code; reverting to the old
local-only routes requires an explicit data-preserving transition.

## Status

Source implementation prepared. See CLOUD_VALIDATION.md for checks performed
and CLOUD_INTEGRATION_RUNBOOK.md for application and remaining Docker/live gates.
The phase remains pending acceptance until those gates pass; the project is not
claimed deployed or complete.
