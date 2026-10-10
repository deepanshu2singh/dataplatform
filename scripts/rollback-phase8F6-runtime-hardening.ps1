[CmdletBinding()]
param(
    [string]$ProjectRoot = (Get-Location).Path,
    [int]$HealthTimeoutSeconds = 120
)

$ErrorActionPreference = 'Stop'
$BaselineHash = 'FD0F65B56B9F493575CBFD19F70D4DC12D19039219877CF92A5FCEFF9BC793FE'

$ProjectRoot = (Resolve-Path $ProjectRoot).Path
Set-Location $ProjectRoot
$ComposePath = Join-Path $ProjectRoot 'docker-compose.prod.yml'
$RollbackPath = Join-Path $ProjectRoot 'docker-compose.prod.pre-8f6.yml'
$EnvPath = Join-Path $ProjectRoot 'production.env'

foreach ($Required in @($RollbackPath, $EnvPath)) {
    if (-not (Test-Path $Required -PathType Leaf)) { throw "Required rollback file not found: $Required" }
}
if ((Get-FileHash $RollbackPath -Algorithm SHA256).Hash -ne $BaselineHash) {
    throw 'docker-compose.prod.pre-8f6.yml is not the verified Phase 8F.5 baseline. Refusing rollback.'
}

Copy-Item $RollbackPath $ComposePath -Force
& docker compose --env-file $EnvPath -f $ComposePath config --quiet
if ($LASTEXITCODE -ne 0) { throw 'Restored Phase 8F.5 Compose file failed validation.' }

function Wait-Healthy {
    param([string]$ContainerName)
    $Deadline = (Get-Date).AddSeconds($HealthTimeoutSeconds)
    while ((Get-Date) -lt $Deadline) {
        $Status = (& docker inspect $ContainerName --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' 2>$null).Trim()
        if ($Status -eq 'healthy') { return }
        if ($Status -eq 'exited' -or $Status -eq 'dead') {
            & docker logs --tail 120 $ContainerName
            throw "$ContainerName entered state: $Status"
        }
        Start-Sleep -Seconds 2
    }
    throw "Timed out waiting for $ContainerName"
}

function Compose-UpOne([string]$Service) {
    & docker compose --env-file $EnvPath -f $ComposePath up -d --no-deps --force-recreate $Service
    if ($LASTEXITCODE -ne 0) { throw "Could not recreate $Service during rollback." }
}

Write-Host 'Restored Phase 8F.5 runtime configuration. Recreating services without changing named volumes...'
Compose-UpOne 'postgres'
Wait-Healthy 'dataplatform-prod-postgres-1'

Compose-UpOne 'migrate'
$MigrationExit = (& docker wait dataplatform-prod-migrate-1).Trim()
if ($MigrationExit -ne '0') {
    & docker logs --tail 120 dataplatform-prod-migrate-1
    throw "Migration run during rollback failed with exit code $MigrationExit"
}

Compose-UpOne 'backend'
Wait-Healthy 'dataplatform-prod-backend-1'
Compose-UpOne 'frontend'
Wait-Healthy 'dataplatform-prod-frontend-1'

Write-Host ''
Write-Host 'PHASE 8F.6 RUNTIME ROLLBACK: COMPLETE' -ForegroundColor Yellow
Write-Host 'The Phase 8F.5 Compose policy is restored. Named database/upload volumes were not replaced or deleted.'
Write-Host 'Database backup files were not restored automatically.'
