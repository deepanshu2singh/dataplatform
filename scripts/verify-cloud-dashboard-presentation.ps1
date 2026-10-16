param([string]$ProjectRoot = "D:\New project\databricks-clone-v1")
$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
$baseCompose = Join-Path $ProjectRoot "docker-compose.test.yml"

foreach ($required in @(
    "docker-compose.test.yml",
    "backend/Dockerfile", "backend/Dockerfile.test",
    "backend/requirements.txt", "backend/requirements-test.txt",
    "backend/tests/test_dashboard_canvas.py",
    "frontend/src/components/dashboard/DashboardCanvas.tsx",
    "frontend/src/components/dashboard/WidgetRenderer.tsx",
    "frontend/src/components/dashboard/WidgetPresentationEditor.tsx",
    "backend/tests/test_dashboard_presentation.py"
)) {
    if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot $required) -PathType Leaf)) {
        throw "Required presentation/test file missing: $required. Stop and share this message."
    }
}

$watched = @(
    "backend/Dockerfile", "backend/Dockerfile.test",
    "backend/requirements.txt", "backend/requirements-test.txt",
    "docker-compose.test.yml", "frontend/package.json", "frontend/package-lock.json"
)
$originalHashes = @{}
foreach ($relative in $watched) {
    $originalHashes[$relative] = (Get-FileHash -LiteralPath (Join-Path $ProjectRoot $relative) -Algorithm SHA256).Hash
}
function Assert-BuildInputsUnchanged {
    foreach ($relative in $watched) {
        $current = (Get-FileHash -LiteralPath (Join-Path $ProjectRoot $relative) -Algorithm SHA256).Hash
        if ($current -ne $originalHashes[$relative]) {
            throw "Build input changed during this run: $relative. Stop here."
        }
    }
}

$recoveryRoot = Join-Path ([IO.Path]::GetTempPath()) ("dataplatform-build-recovery-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $recoveryRoot | Out-Null
$utf8 = New-Object System.Text.UTF8Encoding($false)
$services = @{}
$definitions = @(
    @{ Service = "backend-test-api"; File = "Dockerfile" },
    @{ Service = "backend-tests"; File = "Dockerfile.test" }
)
$pattern = '(?m)^RUN pip install --no-cache-dir(?=\s)'
$replacement = 'RUN --mount=type=cache,id=dataplatform-pip,target=/root/.cache/pip,sharing=locked pip install --timeout 120 --retries 5'
foreach ($entry in $definitions) {
    $source = Join-Path (Join-Path $ProjectRoot "backend") $entry.File
    $original = [IO.File]::ReadAllText($source)
    if ([regex]::Matches($original, $pattern).Count -ne 1) {
        throw "Unexpected pip build instruction in $($entry.File). No project files changed."
    }
    $temporary = Join-Path $recoveryRoot $entry.File
    [IO.File]::WriteAllText($temporary, [regex]::Replace($original, $pattern, $replacement), $utf8)
    $services[$entry.Service] = @{ build = @{ dockerfile = $temporary.Replace('\', '/') } }
}
$overridePath = Join-Path $recoveryRoot "compose.recovery.json"
[IO.File]::WriteAllText($overridePath, (@{ services = $services } | ConvertTo-Json -Depth 8), $utf8)
$composeArgs = @("compose", "-f", $baseCompose, "-f", $overridePath)
Write-Output "RECOVERY_FILES=$recoveryRoot"

$checksPassed = $false
try {
    # Read the merged config into memory; never print environment values.
    $mergedText = & docker @composeArgs config --format json
    if ($LASTEXITCODE -ne 0) { throw "Temporary Compose configuration was rejected. Stop here." }
    $merged = ($mergedText -join "`n") | ConvertFrom-Json
    $backendRoot = [IO.Path]::GetFullPath((Join-Path $ProjectRoot "backend"))
    foreach ($entry in $definitions) {
        $serviceConfig = $merged.services.PSObject.Properties[$entry.Service].Value
        if ([IO.Path]::GetFullPath($serviceConfig.build.context) -ne $backendRoot) {
            throw "Unexpected build context for $($entry.Service). Stop here."
        }
        $expectedDockerfile = Join-Path $recoveryRoot $entry.File
        if ([IO.Path]::GetFullPath($serviceConfig.build.dockerfile) -ne [IO.Path]::GetFullPath($expectedDockerfile)) {
            throw "Temporary Dockerfile was not selected for $($entry.Service). Stop here."
        }
    }
    $testUrl = "postgresql+asyncpg://postgres:postgres@postgres-test:5432/databricks_clone_test"
    foreach ($serviceName in @("backend-test-api", "backend-tests")) {
        if ($merged.services.PSObject.Properties[$serviceName].Value.environment.DATABASE_URL -ne $testUrl) {
            throw "Test database configuration differs from the expected disposable Docker database. Stop here."
        }
    }

    Write-Output "TEMPORARY_BUILD_CONFIGURATION=PASS"
    Write-Output "Building both test images with a 120-second network timeout and shared download cache..."
    & docker @composeArgs build backend-test-api backend-tests
    if ($LASTEXITCODE -ne 0) { throw "Recovery build failed. Stop and share the final build error; do not repeat automatically." }
    Assert-BuildInputsUnchanged
    Write-Output "BACKEND_TEST_IMAGES=PASS"

    & docker @composeArgs up -d --no-build backend-test-api
    if ($LASTEXITCODE -ne 0) { throw "Test API startup failed. Stop and share the output." }
    & docker @composeArgs run --rm backend-tests
    if ($LASTEXITCODE -ne 0) { throw "Backend tests failed. Stop and share the failures." }

    $frontend = Join-Path $ProjectRoot "frontend"
    & npm.cmd --prefix $frontend test
    if ($LASTEXITCODE -ne 0) { throw "Frontend tests failed. Stop here." }
    & npm.cmd --prefix $frontend run lint
    if ($LASTEXITCODE -ne 0) { throw "Frontend lint failed. Stop here." }
    & node.exe (Join-Path $frontend "scripts/build-vercel.mjs")
    if ($LASTEXITCODE -ne 0) { throw "Cloud frontend build failed. Stop here." }
    $checksPassed = $true
} finally {
    Assert-BuildInputsUnchanged
    Write-Output "BUILD_INPUT_FILES_UNCHANGED=PASS"
    Write-Output "RECOVERY_FILES=$recoveryRoot"
}

if ($checksPassed) { Write-Output "WINDOWS_DASHBOARD_PRESENTATION_CHECKS=PASS" }
