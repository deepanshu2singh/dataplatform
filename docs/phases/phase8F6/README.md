# Phase 8F.6 audited runtime-hardening patch

This package is built from the verified Phase 8F.5 production checkpoint after re-auditing lineage against the user-provided Phase 8E complete checkpoint.

## Package layout

- `patch/docker-compose.prod.yml` — the only functional production-source change
- `LINEAGE_AUDIT.md` — checkpoint/source-wiring audit
- `PHASE8F6_RUNTIME_HARDENING.md` — phase specification and acceptance criteria
- `scripts/apply-phase8F6-runtime-hardening.ps1`
- `scripts/deploy-phase8F6-runtime-hardening.ps1`
- `scripts/verify-phase8F6-runtime-hardening.ps1`
- `scripts/rollback-phase8F6-runtime-hardening.ps1`
- `scripts/cleanup-phase8F6-exploratory.ps1`
- `MANIFEST_SHA256.txt`

## Run order

From the project root:

```powershell
& .\phase8F6-runtime-hardening-audited\scripts\apply-phase8F6-runtime-hardening.ps1 -ProjectRoot (Get-Location).Path
```

If that succeeds:

```powershell
& .\phase8F6-runtime-hardening-audited\scripts\deploy-phase8F6-runtime-hardening.ps1 -ProjectRoot (Get-Location).Path
```

If that succeeds:

```powershell
& .\phase8F6-runtime-hardening-audited\scripts\verify-phase8F6-runtime-hardening.ps1 -ProjectRoot (Get-Location).Path
```

Then perform the one manual browser regression defined in `PHASE8F6_RUNTIME_HARDENING.md`.

If a scripted gate fails, stop and inspect that failure. Do not move to the next gate and do not make ad-hoc changes.

## Important

The patch does not contain `production.env`, passwords, database data, TLS certificates/private keys, runtime uploads, or other secrets/runtime artifacts.
