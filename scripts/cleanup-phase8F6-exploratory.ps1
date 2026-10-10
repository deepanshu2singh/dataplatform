[CmdletBinding()]
param(
    [string]$ProjectRoot = (Get-Location).Path
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path $ProjectRoot).Path
Set-Location $ProjectRoot

# This cleanup is intentionally limited to disposable artifacts created during
# pre-implementation Phase 8F.6 exploration. It never touches production
# containers, production volumes, production.env, or backups.

$DisposableContainer = 'dataplatform-8f6-postgres-test'
$DisposableVolume = 'dataplatform-8f6-postgres-test-data'
$TemporaryOverride = Join-Path $ProjectRoot 'docker-compose.8f6-test.yml'

& docker rm -f $DisposableContainer 2>$null | Out-Null
& docker volume rm $DisposableVolume 2>$null | Out-Null

if (Test-Path $TemporaryOverride -PathType Leaf) {
    Remove-Item $TemporaryOverride
    Write-Host "Removed exploratory override: $TemporaryOverride"
}

Write-Host 'Disposable Phase 8F.6 exploratory artifacts cleaned. Production resources were not touched.' -ForegroundColor Green
