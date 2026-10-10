[CmdletBinding()]
param(
    [string]$ProjectRoot = (Get-Location).Path,
    [int]$HealthTimeoutSeconds = 120
)

$ErrorActionPreference = 'Stop'
$TargetHash = 'C14B8ED1A47EB8CF830EC7C140E8CBB87D0E7D184D8DECBA574466B11CD6B67B'

$ProjectRoot = (Resolve-Path $ProjectRoot).Path
Set-Location $ProjectRoot

$ComposePath = Join-Path $ProjectRoot 'docker-compose.prod.yml'
$EnvPath = Join-Path $ProjectRoot 'production.env'
$BackupDir = Join-Path $ProjectRoot 'backups'
$StateDir = Join-Path $ProjectRoot '.phase8f6'

foreach ($Required in @($ComposePath, $EnvPath)) {
    if (-not (Test-Path $Required -PathType Leaf)) {
        throw "Required file not found: $Required"
    }
}

if ((Get-FileHash $ComposePath -Algorithm SHA256).Hash -ne $TargetHash) {
    throw 'docker-compose.prod.yml is not the approved Phase 8F.6 source.'
}

New-Item -ItemType Directory -Force $BackupDir | Out-Null
New-Item -ItemType Directory -Force $StateDir | Out-Null

function Invoke-Compose {
    param([Parameter(Mandatory=$true)][string[]]$ComposeArgs)
    & docker compose --env-file $EnvPath -f $ComposePath @ComposeArgs
    if ($LASTEXITCODE -ne 0) {
        throw "docker compose failed: $($ComposeArgs -join ' ')"
    }
}

function Get-ContainerState {
    param([string]$ContainerName)
    $Value = & docker inspect $ContainerName --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }
    return $Value.Trim()
}

function Wait-Healthy {
    param([string]$ContainerName)
    $Deadline = (Get-Date).AddSeconds($HealthTimeoutSeconds)
    while ((Get-Date) -lt $Deadline) {
        $Status = Get-ContainerState $ContainerName
        if ($Status -eq 'healthy') {
            Write-Host "$ContainerName is healthy." -ForegroundColor Green
            return
        }
        if ($Status -eq 'exited' -or $Status -eq 'dead') {
            & docker logs --tail 120 $ContainerName
            throw "$ContainerName entered state: $Status"
        }
        Start-Sleep -Seconds 2
    }
    & docker logs --tail 120 $ContainerName
    throw "Timed out waiting for $ContainerName to become healthy."
}

Write-Host 'Validating the final Compose configuration...'
Invoke-Compose -ComposeArgs @('config','--quiet')

$PostgresContainer = 'dataplatform-prod-postgres-1'
$MigrateContainer  = 'dataplatform-prod-migrate-1'
$BackendContainer  = 'dataplatform-prod-backend-1'
$FrontendContainer = 'dataplatform-prod-frontend-1'

foreach ($Container in @($PostgresContainer, $BackendContainer, $FrontendContainer)) {
    $Status = Get-ContainerState $Container
    if (-not $Status) { throw "Required production container is not present: $Container" }
}

$Timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$BackupName = "phase8f6-pre-hardening-$Timestamp.dump"
$ContainerBackup = "/tmp/$BackupName"
$HostBackup = Join-Path $BackupDir $BackupName

Write-Host "Creating production PostgreSQL backup: $HostBackup"
& docker exec $PostgresContainer pg_dump -U postgres -d databricks_clone -Fc -f $ContainerBackup
if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed.' }

try {
    & docker cp "${PostgresContainer}:$ContainerBackup" $HostBackup
    if ($LASTEXITCODE -ne 0) { throw 'docker cp failed while exporting the PostgreSQL backup.' }
}
finally {
    & docker exec $PostgresContainer rm -f $ContainerBackup 2>$null
}

if (-not (Test-Path $HostBackup -PathType Leaf) -or (Get-Item $HostBackup).Length -le 0) {
    throw 'The pre-deployment PostgreSQL backup is missing or empty.'
}

$BackupHash = (Get-FileHash $HostBackup -Algorithm SHA256).Hash
Write-Host "Backup SHA-256: $BackupHash"

Write-Host 'Validating the host-side backup archive with pg_restore...'
$ResolvedBackupDir = (Resolve-Path $BackupDir).Path
& docker run --rm -v "${ResolvedBackupDir}:/backup:ro" postgres:15-alpine pg_restore -l "/backup/$BackupName" *> $null
if ($LASTEXITCODE -ne 0) { throw 'pg_restore could not parse the host-side pre-deployment backup.' }
Write-Host 'Backup archive validation passed.' -ForegroundColor Green

$SqlCounts = "SELECT (SELECT count(*) FROM users)::text || '|' || (SELECT count(*) FROM datasets)::text || '|' || (SELECT count(*) FROM notebooks)::text || '|' || (SELECT count(*) FROM dashboards)::text;"
$PreCounts = (& docker exec $PostgresContainer psql -U postgres -d databricks_clone -Atc $SqlCounts).Trim()
if ($LASTEXITCODE -ne 0 -or -not $PreCounts) { throw 'Could not capture pre-deployment application row counts.' }

$PreRevision = (& docker exec $PostgresContainer psql -U postgres -d databricks_clone -Atc 'SELECT version_num FROM alembic_version;').Trim()
if ($LASTEXITCODE -ne 0 -or -not $PreRevision) { throw 'Could not capture the pre-deployment Alembic revision.' }

@{
    backup = $HostBackup
    backup_sha256 = $BackupHash
    counts = $PreCounts
    alembic_revision = $PreRevision
    captured_at = (Get-Date).ToString('o')
} | ConvertTo-Json | Set-Content (Join-Path $StateDir 'pre-deploy-state.json') -Encoding UTF8

Write-Host "Pre-deployment counts users|datasets|notebooks|dashboards: $PreCounts"
Write-Host "Pre-deployment Alembic revision: $PreRevision"

Write-Host 'Recreating PostgreSQL under the Phase 8F.6 runtime policy...'
Invoke-Compose -ComposeArgs @('up','--detach','--no-deps','--force-recreate','postgres')
Wait-Healthy $PostgresContainer

Write-Host 'Running migrations under the Phase 8F.6 runtime policy...'
Invoke-Compose -ComposeArgs @('up','--detach','--no-deps','--force-recreate','migrate')
$MigrationExit = (& docker wait $MigrateContainer).Trim()
if ($MigrationExit -ne '0') {
    & docker logs --tail 120 $MigrateContainer
    throw "Migration failed with exit code $MigrationExit"
}
Write-Host 'Migration exited 0.' -ForegroundColor Green

Write-Host 'Recreating backend under the Phase 8F.6 runtime policy...'
Invoke-Compose -ComposeArgs @('up','--detach','--no-deps','--force-recreate','backend')
Wait-Healthy $BackendContainer

Write-Host 'Recreating frontend under the Phase 8F.6 runtime policy...'
Invoke-Compose -ComposeArgs @('up','--detach','--no-deps','--force-recreate','frontend')
Wait-Healthy $FrontendContainer

$PostCounts = (& docker exec $PostgresContainer psql -U postgres -d databricks_clone -Atc $SqlCounts).Trim()
if ($LASTEXITCODE -ne 0 -or -not $PostCounts) { throw 'Could not capture post-deployment application row counts.' }

$PostRevision = (& docker exec $PostgresContainer psql -U postgres -d databricks_clone -Atc 'SELECT version_num FROM alembic_version;').Trim()
if ($LASTEXITCODE -ne 0 -or -not $PostRevision) { throw 'Could not capture the post-deployment Alembic revision.' }

Write-Host "Post-deployment counts users|datasets|notebooks|dashboards: $PostCounts"
Write-Host "Post-deployment Alembic revision: $PostRevision"

if ($PreCounts -ne $PostCounts) { throw "Application row counts changed unexpectedly. Before=$PreCounts After=$PostCounts" }
if ($PreRevision -ne $PostRevision) { throw "Alembic revision changed unexpectedly. Before=$PreRevision After=$PostRevision" }

@{
    counts = $PostCounts
    alembic_revision = $PostRevision
    completed_at = (Get-Date).ToString('o')
} | ConvertTo-Json | Set-Content (Join-Path $StateDir 'post-deploy-state.json') -Encoding UTF8

Write-Host ''
Write-Host 'PHASE 8F.6 DEPLOYMENT GATE: PASS' -ForegroundColor Green
Write-Host "Emergency DB backup retained at: $HostBackup"
Write-Host 'Run verify-phase8F6-runtime-hardening.ps1 next.'
