[CmdletBinding()]
param(
    [string]$ProjectRoot = (Get-Location).Path
)

$ErrorActionPreference = 'Stop'

$BaselineHash = 'FD0F65B56B9F493575CBFD19F70D4DC12D19039219877CF92A5FCEFF9BC793FE'
$TargetHash   = 'C14B8ED1A47EB8CF830EC7C140E8CBB87D0E7D184D8DECBA574466B11CD6B67B'

$ProjectRoot = (Resolve-Path $ProjectRoot).Path
Set-Location $ProjectRoot

$ComposePath = Join-Path $ProjectRoot 'docker-compose.prod.yml'
$RollbackPath = Join-Path $ProjectRoot 'docker-compose.prod.pre-8f6.yml'
$EnvPath = Join-Path $ProjectRoot 'production.env'
$PatchPath = Join-Path (Split-Path $PSScriptRoot -Parent) 'patch\docker-compose.prod.yml'

foreach ($Required in @($ComposePath, $EnvPath, $PatchPath)) {
    if (-not (Test-Path $Required -PathType Leaf)) {
        throw "Required file not found: $Required"
    }
}

$PatchHash = (Get-FileHash $PatchPath -Algorithm SHA256).Hash
if ($PatchHash -ne $TargetHash) {
    throw "Patch integrity failure. Expected $TargetHash but found $PatchHash"
}

$CurrentHash = (Get-FileHash $ComposePath -Algorithm SHA256).Hash

if (Test-Path $RollbackPath) {
    $RollbackHash = (Get-FileHash $RollbackPath -Algorithm SHA256).Hash
    if ($RollbackHash -ne $BaselineHash) {
        throw "Existing rollback file is not the verified Phase 8F.5 Compose baseline. Refusing to continue: $RollbackPath"
    }
}

if ($CurrentHash -eq $TargetHash) {
    Write-Host 'Phase 8F.6 Compose source is already applied.' -ForegroundColor Yellow
}
elseif ($CurrentHash -eq $BaselineHash) {
    if (-not (Test-Path $RollbackPath)) {
        Copy-Item $ComposePath $RollbackPath
        Write-Host "Created rollback source: $RollbackPath"
    }

    Copy-Item $PatchPath $ComposePath -Force
    Write-Host 'Installed the audited Phase 8F.6 docker-compose.prod.yml.' -ForegroundColor Green
}
else {
    throw "docker-compose.prod.yml does not match the verified Phase 8F.5 baseline or the approved Phase 8F.6 target. Current SHA-256: $CurrentHash"
}

& docker compose --env-file $EnvPath -f $ComposePath config --quiet
if ($LASTEXITCODE -ne 0) {
    if (Test-Path $RollbackPath) {
        Copy-Item $RollbackPath $ComposePath -Force
        Write-Host 'Compose validation failed; restored the Phase 8F.5 source file.' -ForegroundColor Yellow
    }
    throw 'docker compose config validation failed.'
}

$FinalHash = (Get-FileHash $ComposePath -Algorithm SHA256).Hash
if ($FinalHash -ne $TargetHash) {
    throw "Unexpected final docker-compose.prod.yml SHA-256: $FinalHash"
}

Write-Host ''
Write-Host 'PHASE 8F.6 SOURCE GATE: PASS' -ForegroundColor Green
Write-Host "docker-compose.prod.yml SHA-256: $FinalHash"
Write-Host 'No production containers were recreated by this script.'
