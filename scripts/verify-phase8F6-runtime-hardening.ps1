[CmdletBinding()]
param(
    [string]$ProjectRoot = (Get-Location).Path,
    [string]$ProductionOrigin = 'https://app.example.test'
)

$ErrorActionPreference = 'Stop'
$TargetHash = 'C14B8ED1A47EB8CF830EC7C140E8CBB87D0E7D184D8DECBA574466B11CD6B67B'

$ProjectRoot = (Resolve-Path $ProjectRoot).Path
Set-Location $ProjectRoot
$ComposePath = Join-Path $ProjectRoot 'docker-compose.prod.yml'
$EnvPath = Join-Path $ProjectRoot 'production.env'

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}

function Get-Inspect {
    param([string]$Name)
    $Raw = & docker inspect $Name
    if ($LASTEXITCODE -ne 0) { throw "Could not inspect $Name" }
    return ($Raw | ConvertFrom-Json)[0]
}

function Has-TmpfsPath {
    param($Inspect, [string]$Path)
    if ($null -eq $Inspect.HostConfig.Tmpfs) { return $false }
    return ($Inspect.HostConfig.Tmpfs.PSObject.Properties.Name -contains $Path)
}

function Has-NoPublishedPorts {
    param($Inspect)
    if ($null -eq $Inspect.NetworkSettings.Ports) { return $true }
    foreach ($Property in $Inspect.NetworkSettings.Ports.PSObject.Properties) {
        if ($null -ne $Property.Value) { return $false }
    }
    return $true
}

foreach ($Required in @($ComposePath, $EnvPath)) {
    Assert-True (Test-Path $Required -PathType Leaf) "Required file not found: $Required"
}
Assert-True (((Get-FileHash $ComposePath -Algorithm SHA256).Hash) -eq $TargetHash) 'docker-compose.prod.yml is not the approved Phase 8F.6 source.'

& docker compose --env-file $EnvPath -f $ComposePath config --quiet
Assert-True ($LASTEXITCODE -eq 0) 'Final Compose config validation failed.'

$Names = @{
    postgres = 'dataplatform-prod-postgres-1'
    backend  = 'dataplatform-prod-backend-1'
    frontend = 'dataplatform-prod-frontend-1'
}

$Postgres = Get-Inspect $Names.postgres
$Backend  = Get-Inspect $Names.backend
$Frontend = Get-Inspect $Names.frontend

foreach ($Pair in @(
    @{ Label='postgres'; Inspect=$Postgres },
    @{ Label='backend'; Inspect=$Backend },
    @{ Label='frontend'; Inspect=$Frontend }
)) {
    Assert-True ($Pair.Inspect.HostConfig.ReadonlyRootfs -eq $true) "$($Pair.Label): root filesystem is not read-only."
    Assert-True ($Pair.Inspect.HostConfig.SecurityOpt -contains 'no-new-privileges:true') "$($Pair.Label): no-new-privileges is missing."
    Assert-True ($Pair.Inspect.HostConfig.CapDrop -contains 'ALL') "$($Pair.Label): cap_drop ALL is missing."
    Assert-True (Has-TmpfsPath $Pair.Inspect '/tmp') "$($Pair.Label): /tmp tmpfs is missing."
}

Assert-True ($Backend.Config.User -eq 'appuser') 'Backend is not configured to run as appuser.'
Assert-True ($Frontend.Config.User -eq 'nginx') 'Frontend is not configured to run as nginx.'
Assert-True ($Postgres.State.Health.Status -eq 'healthy') 'PostgreSQL is not healthy.'
Assert-True ($Backend.State.Health.Status -eq 'healthy') 'Backend is not healthy.'
Assert-True ($Frontend.State.Health.Status -eq 'healthy') 'Frontend is not healthy.'

# Docker Engine 28+ normalizes capability names in HostConfig to canonical
# forms (for example CAP_CHOWN) while Compose accepts CHOWN. Normalize the
# inspected runtime values so the verifier works across supported Docker
# Engine versions without weakening the approved capability set.
$RequiredPgCaps = @('CHOWN','DAC_OVERRIDE','FOWNER','SETGID','SETUID')
$ActualPgCaps = @(
    $Postgres.HostConfig.CapAdd |
        ForEach-Object { ([string]$_ -replace '^CAP_', '').ToUpperInvariant() } |
        Sort-Object -Unique
)
$ExpectedPgCaps = @($RequiredPgCaps | Sort-Object -Unique)

foreach ($Cap in $ExpectedPgCaps) {
    Assert-True ($ActualPgCaps -contains $Cap) "PostgreSQL missing required capability: $Cap (runtime: $($ActualPgCaps -join ','))"
}
Assert-True ($ActualPgCaps.Count -eq $ExpectedPgCaps.Count) "PostgreSQL has capabilities beyond the approved minimal set (runtime: $($ActualPgCaps -join ','))."
Assert-True (Has-TmpfsPath $Postgres '/var/run/postgresql') 'PostgreSQL socket tmpfs is missing.'

$BackendUpload = $Backend.Mounts | Where-Object Destination -eq '/app/uploads'
Assert-True ($null -ne $BackendUpload -and $BackendUpload.RW) 'Backend uploads_data mount is missing or not writable.'
$PgData = $Postgres.Mounts | Where-Object Destination -eq '/var/lib/postgresql/data'
Assert-True ($null -ne $PgData -and $PgData.RW) 'PostgreSQL data mount is missing or not writable.'

Assert-True (Has-NoPublishedPorts $Backend) 'Backend unexpectedly publishes a host port.'
Assert-True (Has-NoPublishedPorts $Postgres) 'PostgreSQL unexpectedly publishes a host port.'

# Migrate is a one-shot service. Do not trust metadata from an old exited named
# container as proof of the current Compose policy. Create fresh ephemeral
# containers from the final Compose definition and validate each property with
# simple argv calls. This intentionally avoids passing a compound shell program
# through Windows PowerShell/native argument quoting.

$MigrateUser = (& docker compose --env-file $EnvPath -f $ComposePath run --rm --no-deps --entrypoint id migrate -un).Trim()
Assert-True ($LASTEXITCODE -eq 0 -and $MigrateUser -eq 'appuser') "Migration service is not running as appuser (runtime user: $MigrateUser)."

& docker compose --env-file $EnvPath -f $ComposePath run --rm --no-deps --entrypoint touch migrate /tmp/8f6-migrate-verify
Assert-True ($LASTEXITCODE -eq 0) 'Migration service /tmp is not writable.'

# Verify the fresh migrate container sees the root filesystem mounted read-only
# without intentionally running a failing native command. Windows PowerShell 5.1
# can promote expected native stderr/non-zero exits to a terminating NativeCommandError
# when ErrorActionPreference is Stop, which would make the verifier itself fail.
$RootMountPattern = '^[^ ]+ / [^ ]+ ro([, ]|$)'
$MigrateRootMount = (& docker compose --env-file $EnvPath -f $ComposePath run --rm --no-deps --entrypoint grep migrate -E $RootMountPattern /proc/mounts) -join "`n"
Assert-True ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($MigrateRootMount)) 'Migration service root filesystem is not mounted read-only at runtime.'

$MigrateStatus = (& docker compose --env-file $EnvPath -f $ComposePath run --rm --no-deps --entrypoint cat migrate /proc/self/status) -join "`n"
Assert-True ($LASTEXITCODE -eq 0) 'Could not read migration service process security status.'
Assert-True ($MigrateStatus -match '(?m)^NoNewPrivs:\s+1\s*$') 'Migration service no-new-privileges is not active at runtime.'
Assert-True ($MigrateStatus -match '(?m)^CapBnd:\s+0000000000000000\s*$') 'Migration service capability bounding set is not empty at runtime.'

& docker compose --env-file $EnvPath -f $ComposePath run --rm --no-deps migrate
Assert-True ($LASTEXITCODE -eq 0) 'Migration service did not complete successfully under the final Phase 8F.6 policy.'

& docker exec $Names.backend sh -lc 'set -e; touch /tmp/8f6-verify; rm /tmp/8f6-verify; touch /app/uploads/8f6-verify; rm /app/uploads/8f6-verify; if touch /app/8f6-should-not-write 2>/dev/null; then rm -f /app/8f6-should-not-write; exit 41; fi'
Assert-True ($LASTEXITCODE -eq 0) 'Backend filesystem-boundary verification failed.'

& docker exec $Names.frontend sh -lc 'set -e; touch /tmp/8f6-verify; rm /tmp/8f6-verify; if touch /usr/share/nginx/html/8f6-should-not-write 2>/dev/null; then rm -f /usr/share/nginx/html/8f6-should-not-write; exit 42; fi; if touch /etc/nginx/8f6-should-not-write 2>/dev/null; then rm -f /etc/nginx/8f6-should-not-write; exit 43; fi'
Assert-True ($LASTEXITCODE -eq 0) 'Frontend filesystem-boundary verification failed.'

& docker exec -u postgres $Names.postgres sh -lc 'set -e; touch /tmp/8f6-verify; rm /tmp/8f6-verify; touch /var/run/postgresql/8f6-verify; rm /var/run/postgresql/8f6-verify; touch /var/lib/postgresql/data/8f6-verify; rm /var/lib/postgresql/data/8f6-verify'
Assert-True ($LASTEXITCODE -eq 0) 'PostgreSQL intended writable-path verification failed.'
& docker exec $Names.postgres sh -lc 'if touch /etc/8f6-should-not-write 2>/dev/null; then rm -f /etc/8f6-should-not-write; exit 44; fi'
Assert-True ($LASTEXITCODE -eq 0) 'PostgreSQL root filesystem unexpectedly accepted a write.'

$PgReady = (& docker exec $Names.postgres pg_isready -U postgres -d databricks_clone).Trim()
Assert-True ($LASTEXITCODE -eq 0 -and $PgReady -match 'accepting connections') 'PostgreSQL readiness check failed.'

$BackendReady = (& docker exec $Names.frontend busybox wget -qO- http://backend:8000/health/ready).Trim()
Assert-True ($LASTEXITCODE -eq 0 -and $BackendReady -match '"status":"ready"') 'Backend readiness through the production edge network failed.'

$FrontendHealth = (& docker exec $Names.frontend busybox wget -qO- http://127.0.0.1:8080/healthz).Trim()
Assert-True ($LASTEXITCODE -eq 0 -and $FrontendHealth -eq 'ok') 'Frontend health endpoint failed.'

$HttpsResponse = Invoke-WebRequest -Uri "$ProductionOrigin/api/v1/openapi.json" -UseBasicParsing
Assert-True ($HttpsResponse.StatusCode -eq 200) 'Trusted production HTTPS OpenAPI request did not return 200.'

Write-Host ''
Write-Host 'PHASE 8F.6 AUTOMATED ACCEPTANCE GATE: PASS' -ForegroundColor Green
Write-Host "HTTPS OpenAPI: $($HttpsResponse.StatusCode)"
Write-Host "PostgreSQL: $PgReady"
Write-Host "Backend readiness: $BackendReady"
Write-Host "Frontend health: $FrontendHealth"
Write-Host 'Migrate: fresh hardened runtime probe + Alembic upgrade head passed.'
Write-Host 'Next gate: one authenticated browser regression (login -> dataset -> notebook SQL -> dashboard Refresh Data -> logout).'
