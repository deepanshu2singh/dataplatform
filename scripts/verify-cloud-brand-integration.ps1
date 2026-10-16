param([string]$ProjectRoot = 'D:\New project\databricks-clone-v1')
$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
$frontend = Join-Path $ProjectRoot 'frontend'
$inputs = @('frontend/package.json','frontend/package-lock.json','frontend/vite.config.ts','frontend/vitest.config.ts','frontend/build/editorSanitizer.ts','frontend/scripts/build-vercel.mjs','vercel.json')
$before = @{}
foreach ($relative in $inputs) { $before[$relative] = (Get-FileHash -LiteralPath (Join-Path $ProjectRoot $relative) -Algorithm SHA256).Hash }
Push-Location $ProjectRoot
try {
    if (-not (Test-Path -LiteralPath (Join-Path $frontend 'node_modules/.bin/vitest.cmd'))) {
        & npm.cmd --prefix $frontend ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. Stop and share the output.' }
    }
    & npm.cmd --prefix $frontend test -- --maxWorkers=2 --testTimeout=15000
    if ($LASTEXITCODE -ne 0) { throw 'Frontend tests failed. Stop and share the output.' }
    & npm.cmd --prefix $frontend run lint
    if ($LASTEXITCODE -ne 0) { throw 'Frontend lint failed. Stop and share the output.' }
    & node (Join-Path $frontend 'scripts/build-vercel.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Cloud build failed. Stop and share the output.' }
    & node (Join-Path $frontend 'scripts/verify-brand-assets.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Built branding assets failed verification.' }
} finally {
    Pop-Location
    foreach ($relative in $inputs) {
        if ((Get-FileHash -LiteralPath (Join-Path $ProjectRoot $relative) -Algorithm SHA256).Hash -ne $before[$relative]) { throw ('Build input changed unexpectedly: ' + $relative) }
    }
}
Write-Host 'BUILD_INPUT_FILES_UNCHANGED=PASS'
Write-Host 'WINDOWS_BRAND_INTEGRATION_CHECKS=PASS'
