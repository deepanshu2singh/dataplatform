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
$StatePath = Join-Path $ProjectRoot '.phase8f6\pre-deploy-state.json'
$PostStatePath = Join-Path $ProjectRoot '.phase8f6\post-deploy-state.json'

foreach ($Required in @($ComposePath,$EnvPath,$StatePath)) {
    if (-not (Test-Path $Required -PathType Leaf)) { throw "Required resume file not found: $Required" }
}
if ((Get-FileHash $ComposePath -Algorithm SHA256).Hash -ne $TargetHash) {
    throw 'docker-compose.prod.yml is not the approved Phase 8F.6 source.'
}

$Pre = Get-Content $StatePath -Raw | ConvertFrom-Json
if (-not (Test-Path $Pre.backup -PathType Leaf)) { throw "Recorded pre-deployment backup is missing: $($Pre.backup)" }
$BackupHash = (Get-FileHash $Pre.backup -Algorithm SHA256).Hash
if ($BackupHash -ne $Pre.backup_sha256) { throw 'Recorded pre-deployment backup SHA-256 no longer matches.' }

function Compose([string[]]$Args) {
    & docker compose --env-file $EnvPath -f $ComposePath @Args
    if ($LASTEXITCODE -ne 0) { throw "docker compose failed: $($Args -join ' ')" }
}
function State([string]$Name) {
    $v = & docker inspect $Name --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }
    return $v.Trim()
}
function WaitHealthy([string]$Name) {
    $Deadline = (Get-Date).AddSeconds($HealthTimeoutSeconds)
    while ((Get-Date) -lt $Deadline) {
        $s = State $Name
        if ($s -eq 'healthy') { Write-Host "$Name is healthy." -ForegroundColor Green; return }
        if ($s -eq 'exited' -or $s -eq 'dead') { & docker logs --tail 120 $Name; throw "$Name entered state: $s" }
        Start-Sleep -Seconds 2
    }
    & docker logs --tail 120 $Name
    throw "Timed out waiting for $Name to become healthy."
}

$Postgres='dataplatform-prod-postgres-1'
$Migrate='dataplatform-prod-migrate-1'
$Backend='dataplatform-prod-backend-1'
$Frontend='dataplatform-prod-frontend-1'
$SqlCounts = "SELECT (SELECT count(*) FROM users)::text || '|' || (SELECT count(*) FROM datasets)::text || '|' || (SELECT count(*) FROM notebooks)::text || '|' || (SELECT count(*) FROM dashboards)::text;"

Write-Host 'Validating final Compose and recorded pre-deployment state...'
Compose @('config','--quiet')
Write-Host "Recorded backup: $($Pre.backup)"
Write-Host "Recorded counts: $($Pre.counts)"
Write-Host "Recorded Alembic revision: $($Pre.alembic_revision)"

# Ensure PostgreSQL is running under the final Compose definition. If Ctrl+C stopped
# the attached compose process, this starts it again without replacing the volume.
Compose @('up','--detach','--no-deps','postgres')
WaitHealthy $Postgres

$PgInspect = (& docker inspect $Postgres | ConvertFrom-Json)[0]
if (-not $PgInspect.HostConfig.ReadonlyRootfs) { throw 'PostgreSQL is not running with read-only root filesystem.' }
if (-not ($PgInspect.HostConfig.CapDrop -contains 'ALL')) { throw 'PostgreSQL cap_drop ALL is missing.' }
if (-not ($PgInspect.HostConfig.SecurityOpt -contains 'no-new-privileges:true')) { throw 'PostgreSQL no-new-privileges is missing.' }
Write-Host 'PostgreSQL final runtime policy confirmed.' -ForegroundColor Green

Write-Host 'Running migrations under the final Phase 8F.6 policy...'
Compose @('up','--detach','--no-deps','--force-recreate','migrate')
$MigrationExit = (& docker wait $Migrate).Trim()
if ($MigrationExit -ne '0') { & docker logs --tail 120 $Migrate; throw "Migration failed with exit code $MigrationExit" }
Write-Host 'Migration exited 0.' -ForegroundColor Green

Write-Host 'Recreating backend under the final Phase 8F.6 policy...'
Compose @('up','--detach','--no-deps','--force-recreate','backend')
WaitHealthy $Backend

Write-Host 'Recreating frontend under the final Phase 8F.6 policy...'
Compose @('up','--detach','--no-deps','--force-recreate','frontend')
WaitHealthy $Frontend

$PostCounts = (& docker exec $Postgres psql -U postgres -d databricks_clone -Atc $SqlCounts).Trim()
if ($LASTEXITCODE -ne 0 -or -not $PostCounts) { throw 'Could not capture post-deployment application row counts.' }
$PostRevision = (& docker exec $Postgres psql -U postgres -d databricks_clone -Atc 'SELECT version_num FROM alembic_version;').Trim()
if ($LASTEXITCODE -ne 0 -or -not $PostRevision) { throw 'Could not capture post-deployment Alembic revision.' }

Write-Host "Post-deployment counts users|datasets|notebooks|dashboards: $PostCounts"
Write-Host "Post-deployment Alembic revision: $PostRevision"
if ($PostCounts -ne $Pre.counts) { throw "Application row counts changed unexpectedly. Before=$($Pre.counts) After=$PostCounts" }
if ($PostRevision -ne $Pre.alembic_revision) { throw "Alembic revision changed unexpectedly. Before=$($Pre.alembic_revision) After=$PostRevision" }

@{ counts=$PostCounts; alembic_revision=$PostRevision; completed_at=(Get-Date).ToString('o'); resumed=$true } |
    ConvertTo-Json | Set-Content $PostStatePath -Encoding UTF8

Write-Host ''
Write-Host 'PHASE 8F.6 DEPLOYMENT GATE: PASS' -ForegroundColor Green
Write-Host "Emergency DB backup retained at: $($Pre.backup)"
Write-Host 'Deployment resumed safely from the recorded pre-deployment state.'
Write-Host 'Run verify-phase8F6-runtime-hardening.ps1 next.'
