[CmdletBinding()]
param(
    [string]$ProjectRoot = (Get-Location).Path,
    [string]$ProductionOrigin = 'https://app.example.test'
)

$ErrorActionPreference = 'Stop'

$TargetComposeHash =
    '9EB5408452AC3E615B4E9348B2B912AD2783694E437EE1D418A0D7D6387A6A20'

$TargetEnvExampleHash =
    '5261323E7CB672E685E7D5ACECA4C37D77C71543BC2C1D61382C74EE45F22834'

$ProjectRoot = (Resolve-Path $ProjectRoot).Path
Set-Location $ProjectRoot

$ComposePath = Join-Path `
    $ProjectRoot `
    'docker-compose.prod.yml'

$EnvPath = Join-Path `
    $ProjectRoot `
    'production.env'

$EnvExamplePath = Join-Path `
    $ProjectRoot `
    'production.env.example'

function Assert-True {

    param(
        [bool]$Condition,
        [string]$Message
    )

    if (-not $Condition) {
        throw $Message
    }
}


function Get-Inspect {

    param(
        [string]$Name
    )

    $Raw = & docker inspect $Name

    if ($LASTEXITCODE -ne 0) {
        throw "Could not inspect $Name"
    }

    return ($Raw | ConvertFrom-Json)[0]
}


function Has-TmpfsPath {

    param(
        $Inspect,
        [string]$Path
    )

    if ($null -eq $Inspect.HostConfig.Tmpfs) {
        return $false
    }

    return (
        $Inspect.HostConfig.Tmpfs.PSObject.Properties.Name `
            -contains $Path
    )
}


function Has-NoPublishedPorts {

    param(
        $Inspect
    )

    if ($null -eq $Inspect.NetworkSettings.Ports) {
        return $true
    }

    foreach (
        $Property in
        $Inspect.NetworkSettings.Ports.PSObject.Properties
    ) {

        if ($null -ne $Property.Value) {
            return $false
        }
    }

    return $true
}


function Assert-ResourceLimits {

    param(
        $Inspect,
        [string]$Label,
        [int64]$NanoCpus,
        [int64]$Memory,
        [int64]$Pids
    )

    Assert-True `
        ([int64]$Inspect.HostConfig.NanoCpus -eq $NanoCpus) `
        "$Label CPU limit is incorrect. Expected $NanoCpus, found $($Inspect.HostConfig.NanoCpus)."

    Assert-True `
        ([int64]$Inspect.HostConfig.Memory -eq $Memory) `
        "$Label memory limit is incorrect. Expected $Memory, found $($Inspect.HostConfig.Memory)."

    Assert-True `
        ([int64]$Inspect.HostConfig.PidsLimit -eq $Pids) `
        "$Label PID limit is incorrect. Expected $Pids, found $($Inspect.HostConfig.PidsLimit)."

    Assert-True `
        ($Inspect.State.OOMKilled -eq $false) `
        "$Label reports OOMKilled=true."
}

# ============================================================
# 1. SOURCE INTEGRITY
# ============================================================

Write-Host ""
Write-Host "=== Phase 8F.7 source integrity ==="

foreach (
    $Required in @(
        $ComposePath,
        $EnvPath,
        $EnvExamplePath
    )
) {

    Assert-True `
        (Test-Path $Required -PathType Leaf) `
        "Required file not found: $Required"
}

$ActualComposeHash = (
    Get-FileHash `
        $ComposePath `
        -Algorithm SHA256
).Hash

$ActualEnvExampleHash = (
    Get-FileHash `
        $EnvExamplePath `
        -Algorithm SHA256
).Hash

Assert-True `
    ($ActualComposeHash -eq $TargetComposeHash) `
    'docker-compose.prod.yml is not the approved Phase 8F.7 source.'

Assert-True `
    ($ActualEnvExampleHash -eq $TargetEnvExampleHash) `
    'production.env.example is not the approved Phase 8F.7 source.'

Write-Host "PASS  Phase 8F.7 source hashes"

# ============================================================
# 2. COMPOSE MODEL
# ============================================================

& docker compose `
    --env-file $EnvPath `
    -f $ComposePath `
    config `
    --quiet

Assert-True `
    ($LASTEXITCODE -eq 0) `
    'Final Compose configuration validation failed.'

Write-Host "PASS  Compose configuration"

# ============================================================
# 3. RUNNING SERVICE INSPECTION
# ============================================================

$Names = @{
    postgres = 'dataplatform-prod-postgres-1'
    backend  = 'dataplatform-prod-backend-1'
    frontend = 'dataplatform-prod-frontend-1'
}

$Postgres = Get-Inspect $Names.postgres
$Backend  = Get-Inspect $Names.backend
$Frontend = Get-Inspect $Names.frontend

# ============================================================
# 4. PHASE 8F.6 HARDENING REGRESSION
# ============================================================

Write-Host ""
Write-Host "=== Phase 8F.6 hardening regression ==="

foreach (
    $Pair in @(
        @{
            Label = 'postgres'
            Inspect = $Postgres
        },
        @{
            Label = 'backend'
            Inspect = $Backend
        },
        @{
            Label = 'frontend'
            Inspect = $Frontend
        }
    )
) {

    Assert-True `
        ($Pair.Inspect.HostConfig.ReadonlyRootfs -eq $true) `
        "$($Pair.Label): root filesystem is not read-only."

    Assert-True `
        (
            $Pair.Inspect.HostConfig.SecurityOpt `
                -contains 'no-new-privileges:true'
        ) `
        "$($Pair.Label): no-new-privileges is missing."

    Assert-True `
        (
            $Pair.Inspect.HostConfig.CapDrop `
                -contains 'ALL'
        ) `
        "$($Pair.Label): cap_drop ALL is missing."

    Assert-True `
        (Has-TmpfsPath $Pair.Inspect '/tmp') `
        "$($Pair.Label): /tmp tmpfs is missing."
}

Assert-True `
    ($Backend.Config.User -eq 'appuser') `
    'Backend is not configured to run as appuser.'

Assert-True `
    ($Frontend.Config.User -eq 'nginx') `
    'Frontend is not configured to run as nginx.'

Assert-True `
    ($Postgres.State.Health.Status -eq 'healthy') `
    'PostgreSQL is not healthy.'

Assert-True `
    ($Backend.State.Health.Status -eq 'healthy') `
    'Backend is not healthy.'

Assert-True `
    ($Frontend.State.Health.Status -eq 'healthy') `
    'Frontend is not healthy.'

Write-Host "PASS  existing runtime hardening"
Write-Host "PASS  persistent-service health"

# ============================================================
# 5. POSTGRES CAPABILITY POLICY
# ============================================================

$RequiredPgCaps = @(
    'CHOWN',
    'DAC_OVERRIDE',
    'FOWNER',
    'SETGID',
    'SETUID'
)

$ActualPgCaps = @(
    $Postgres.HostConfig.CapAdd |
        ForEach-Object {
            (
                [string]$_ `
                    -replace '^CAP_', ''
            ).ToUpperInvariant()
        } |
        Sort-Object -Unique
)

$ExpectedPgCaps = @(
    $RequiredPgCaps |
        Sort-Object -Unique
)

foreach ($Cap in $ExpectedPgCaps) {

    Assert-True `
        ($ActualPgCaps -contains $Cap) `
        "PostgreSQL missing required capability: $Cap"
}

Assert-True `
    ($ActualPgCaps.Count -eq $ExpectedPgCaps.Count) `
    'PostgreSQL has capabilities beyond the approved minimal set.'

Assert-True `
    (Has-TmpfsPath $Postgres '/var/run/postgresql') `
    'PostgreSQL socket tmpfs is missing.'

# ============================================================
# 6. WRITABLE MOUNTS / NETWORK BOUNDARIES
# ============================================================

$BackendUpload =
    $Backend.Mounts |
    Where-Object Destination -eq '/app/uploads'

Assert-True `
    (
        $null -ne $BackendUpload `
        -and $BackendUpload.RW
    ) `
    'Backend uploads_data mount is missing or not writable.'

$PgData =
    $Postgres.Mounts |
    Where-Object Destination -eq '/var/lib/postgresql/data'

Assert-True `
    (
        $null -ne $PgData `
        -and $PgData.RW
    ) `
    'PostgreSQL data mount is missing or not writable.'

Assert-True `
    (Has-NoPublishedPorts $Backend) `
    'Backend unexpectedly publishes a host port.'

Assert-True `
    (Has-NoPublishedPorts $Postgres) `
    'PostgreSQL unexpectedly publishes a host port.'

Write-Host "PASS  mount and network boundaries"

# ============================================================
# 7. PHASE 8F.7 PERSISTENT-SERVICE RESOURCE LIMITS
# ============================================================

Write-Host ""
Write-Host "=== Phase 8F.7 resource limits ==="

Assert-ResourceLimits `
    -Inspect $Postgres `
    -Label 'postgres' `
    -NanoCpus 1000000000 `
    -Memory 536870912 `
    -Pids 128

Assert-ResourceLimits `
    -Inspect $Backend `
    -Label 'backend' `
    -NanoCpus 2000000000 `
    -Memory 1610612736 `
    -Pids 128

Assert-ResourceLimits `
    -Inspect $Frontend `
    -Label 'frontend' `
    -NanoCpus 500000000 `
    -Memory 268435456 `
    -Pids 64

Write-Host "PASS  postgres CPU / memory / PID limits"
Write-Host "PASS  backend CPU / memory / PID limits"
Write-Host "PASS  frontend CPU / memory / PID limits"

# ============================================================
# 8. FRESH MIGRATE RESOURCE INSPECTION
# ============================================================

Write-Host ""
Write-Host "=== Fresh migrate resource validation ==="

$MigrateProbeName =
    'dataplatform-prod-migrate-8f7-acceptance'

$ExistingMigrateProbe = (
    @(
        docker ps `
            -a `
            --filter "name=^/$MigrateProbeName$" `
            -q
    ) -join "`n"
).Trim()

if ($ExistingMigrateProbe) {

    docker rm `
        -f `
        $MigrateProbeName |
        Out-Null

    Assert-True `
        ($LASTEXITCODE -eq 0) `
        'Could not remove stale Phase 8F.7 migrate acceptance container.'
}

try {

    $MigrateUser = (
    @(
        & docker compose `
            --env-file $EnvPath `
            -f $ComposePath `
            run `
            --name $MigrateProbeName `
            --no-deps `
            --entrypoint id `
            migrate `
            -un
    ) -join "`n"
).Trim()

    Assert-True `
        (
            $LASTEXITCODE -eq 0 `
            -and $MigrateUser -eq 'appuser'
        ) `
        "Migration service is not running as appuser."

    $MigrateInspect =
        Get-Inspect $MigrateProbeName

    Assert-True `
        ($MigrateInspect.State.Status -eq 'exited') `
        'Migrate resource probe did not exit.'

    Assert-True `
        ([int]$MigrateInspect.State.ExitCode -eq 0) `
        'Migrate resource probe exited unsuccessfully.'

    Assert-True `
        ($MigrateInspect.HostConfig.ReadonlyRootfs -eq $true) `
        'Migrate root filesystem is not read-only.'

    Assert-True `
        (
            $MigrateInspect.HostConfig.SecurityOpt `
                -contains 'no-new-privileges:true'
        ) `
        'Migrate no-new-privileges is missing.'

    Assert-True `
        (
            $MigrateInspect.HostConfig.CapDrop `
                -contains 'ALL'
        ) `
        'Migrate cap_drop ALL is missing.'

    Assert-True `
        (Has-TmpfsPath $MigrateInspect '/tmp') `
        'Migrate /tmp tmpfs is missing.'

    Assert-ResourceLimits `
        -Inspect $MigrateInspect `
        -Label 'migrate' `
        -NanoCpus 1000000000 `
        -Memory 402653184 `
        -Pids 64

    Write-Host "PASS  migrate CPU / memory / PID limits"
}
finally {

   $ProbeStillExists = (
    @(
        docker ps `
            -a `
            --filter "name=^/$MigrateProbeName$" `
            -q
    ) -join "`n"
).Trim()

    if ($ProbeStillExists) {

        docker rm `
            -f `
            $MigrateProbeName |
            Out-Null
    }
}

# ============================================================
# 9. MIGRATE RUNTIME HARDENING
# ============================================================

Write-Host ""
Write-Host "=== Fresh migrate runtime-hardening probes ==="

& docker compose `
    --env-file $EnvPath `
    -f $ComposePath `
    run `
    --rm `
    --no-deps `
    --entrypoint touch `
    migrate `
    /tmp/8f7-migrate-verify

Assert-True `
    ($LASTEXITCODE -eq 0) `
    'Migration service /tmp is not writable.'

$RootMountPattern =
    '^[^ ]+ / [^ ]+ ro([, ]|$)'

$MigrateRootMount = (
    & docker compose `
        --env-file $EnvPath `
        -f $ComposePath `
        run `
        --rm `
        --no-deps `
        --entrypoint grep `
        migrate `
        -E `
        $RootMountPattern `
        /proc/mounts
) -join "`n"

Assert-True `
    (
        $LASTEXITCODE -eq 0 `
        -and -not [string]::IsNullOrWhiteSpace(
            $MigrateRootMount
        )
    ) `
    'Migration service root filesystem is not mounted read-only.'

$MigrateStatus = (
    & docker compose `
        --env-file $EnvPath `
        -f $ComposePath `
        run `
        --rm `
        --no-deps `
        --entrypoint cat `
        migrate `
        /proc/self/status
) -join "`n"

Assert-True `
    ($LASTEXITCODE -eq 0) `
    'Could not read migration service security status.'

Assert-True `
    (
        $MigrateStatus -match
        '(?m)^NoNewPrivs:\s+1\s*$'
    ) `
    'Migration service no-new-privileges is not active.'

Assert-True `
    (
        $MigrateStatus -match
        '(?m)^CapBnd:\s+0000000000000000\s*$'
    ) `
    'Migration service capability bounding set is not empty.'

& docker compose `
    --env-file $EnvPath `
    -f $ComposePath `
    run `
    --rm `
    --no-deps `
    migrate

Assert-True `
    ($LASTEXITCODE -eq 0) `
    'Migration service did not complete successfully.'

Write-Host "PASS  migrate runtime hardening"
Write-Host "PASS  Alembic upgrade head"

# ============================================================
# 10. FILESYSTEM BOUNDARY REGRESSION
# ============================================================

& docker exec `
    $Names.backend `
    sh `
    -lc `
    'set -e; touch /tmp/8f7-verify; rm /tmp/8f7-verify; touch /app/uploads/8f7-verify; rm /app/uploads/8f7-verify; if touch /app/8f7-should-not-write 2>/dev/null; then rm -f /app/8f7-should-not-write; exit 41; fi'

Assert-True `
    ($LASTEXITCODE -eq 0) `
    'Backend filesystem-boundary verification failed.'

& docker exec `
    $Names.frontend `
    sh `
    -lc `
    'set -e; touch /tmp/8f7-verify; rm /tmp/8f7-verify; if touch /usr/share/nginx/html/8f7-should-not-write 2>/dev/null; then rm -f /usr/share/nginx/html/8f7-should-not-write; exit 42; fi; if touch /etc/nginx/8f7-should-not-write 2>/dev/null; then rm -f /etc/nginx/8f7-should-not-write; exit 43; fi'

Assert-True `
    ($LASTEXITCODE -eq 0) `
    'Frontend filesystem-boundary verification failed.'

& docker exec `
    -u postgres `
    $Names.postgres `
    sh `
    -lc `
    'set -e; touch /tmp/8f7-verify; rm /tmp/8f7-verify; touch /var/run/postgresql/8f7-verify; rm /var/run/postgresql/8f7-verify; touch /var/lib/postgresql/data/8f7-verify; rm /var/lib/postgresql/data/8f7-verify'

Assert-True `
    ($LASTEXITCODE -eq 0) `
    'PostgreSQL intended writable-path verification failed.'

& docker exec `
    $Names.postgres `
    sh `
    -lc `
    'if touch /etc/8f7-should-not-write 2>/dev/null; then rm -f /etc/8f7-should-not-write; exit 44; fi'

Assert-True `
    ($LASTEXITCODE -eq 0) `
    'PostgreSQL root filesystem unexpectedly accepted a write.'

Write-Host "PASS  filesystem boundaries"

# ============================================================
# 11. READINESS / HTTPS REGRESSION
# ============================================================

$PgReady = (
    @(
        & docker exec `
            $Names.postgres `
            pg_isready `
            -U postgres `
            -d databricks_clone
    ) -join "`n"
).Trim()

Assert-True `
    (
        $LASTEXITCODE -eq 0 `
        -and $PgReady -match 'accepting connections'
    ) `
    'PostgreSQL readiness check failed.'

$BackendReady = (
    @(
        & docker exec `
            $Names.frontend `
            busybox `
            wget `
            -qO- `
            http://backend:8000/health/ready
    ) -join "`n"
).Trim()

Assert-True `
    (
        $LASTEXITCODE -eq 0 `
        -and $BackendReady -match '"status":"ready"'
    ) `
    'Backend readiness through production network failed.'

$FrontendHealth = (
    @(
        & docker exec `
            $Names.frontend `
            busybox `
            wget `
            -qO- `
            http://127.0.0.1:8080/healthz
    ) -join "`n"
).Trim()

Assert-True `
    (
        $LASTEXITCODE -eq 0 `
        -and $FrontendHealth -eq 'ok'
    ) `
    'Frontend health endpoint failed.'

$HttpsResponse =
    Invoke-WebRequest `
        -Uri "$ProductionOrigin/api/v1/openapi.json" `
        -UseBasicParsing

Assert-True `
    ($HttpsResponse.StatusCode -eq 200) `
    'Trusted production HTTPS OpenAPI request did not return 200.'

# ============================================================
# PASS
# ============================================================

Write-Host ""
Write-Host "============================================================"
Write-Host "PHASE 8F.7 AUTOMATED ACCEPTANCE GATE: PASS" `
    -ForegroundColor Green
Write-Host "============================================================"

Write-Host ""
Write-Host "HTTPS OpenAPI: $($HttpsResponse.StatusCode)"
Write-Host "PostgreSQL: $PgReady"
Write-Host "Backend readiness: $BackendReady"
Write-Host "Frontend health: $FrontendHealth"

Write-Host ""
Write-Host "Applied resource limits:"
Write-Host "  postgres  CPU=1.0  MEM=512MiB   PIDS=128"
Write-Host "  migrate   CPU=1.0  MEM=384MiB   PIDS=64"
Write-Host "  backend   CPU=2.0  MEM=1536MiB  PIDS=128"
Write-Host "  frontend  CPU=0.5  MEM=256MiB   PIDS=64"

Write-Host ""
Write-Host "Phase 8F.6 hardening regression: PASS"
Write-Host "Migrate + Alembic regression:     PASS"
Write-Host "OOM status:                       PASS"

Write-Host ""
Write-Host "Next gate:"
Write-Host "authenticated browser regression"
Write-Host "============================================================"