param([string]$ProjectRoot = "D:\New project\databricks-clone-v1")
$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
$watched = @(
    "backend/Dockerfile", "backend/Dockerfile.test",
    "backend/requirements.txt", "backend/requirements-test.txt",
    "docker-compose.test.yml", "frontend/package.json", "frontend/package-lock.json"
)
foreach ($required in @("frontend/src/components/dashboard/WidgetPresentationEditor.tsx", "frontend/src/components/dashboard/WidgetPresentationEditor.test.tsx", "frontend/scripts/build-vercel.mjs")) {
    if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot $required) -PathType Leaf)) { throw "Required selector/build file missing: $required" }
}
$before = @{}
foreach ($file in $watched) { $before[$file] = (Get-FileHash -LiteralPath (Join-Path $ProjectRoot $file) -Algorithm SHA256).Hash }
$checksPassed = $false
try {
    $frontend = Join-Path $ProjectRoot "frontend"
    Write-Output "FRONTEND_TEST_WORKERS=2"
    Write-Output "FRONTEND_TEST_TIMEOUT_MS=15000"
    & npm.cmd --prefix $frontend test -- --maxWorkers=2 --testTimeout=15000
    if ($LASTEXITCODE -ne 0) { throw "Frontend tests failed. Stop and share the actual failed-test details." }
    & npm.cmd --prefix $frontend run lint
    if ($LASTEXITCODE -ne 0) { throw "Frontend lint failed. Stop and share the output." }
    & node.exe (Join-Path $frontend "scripts/build-vercel.mjs")
    if ($LASTEXITCODE -ne 0) { throw "Cloud frontend build failed. Stop and share the output." }
    $checksPassed = $true
} finally {
    foreach ($file in $watched) {
        $after = (Get-FileHash -LiteralPath (Join-Path $ProjectRoot $file) -Algorithm SHA256).Hash
        if ($after -ne $before[$file]) { throw "Build input changed: $file. Stop here." }
    }
    Write-Output "BUILD_INPUT_FILES_UNCHANGED=PASS"
}
if ($checksPassed) { Write-Output "WINDOWS_DASHBOARD_COLUMN_SELECTORS_CHECKS=PASS" }
