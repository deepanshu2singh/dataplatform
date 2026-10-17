param([string]$ProjectRoot = 'D:\New project\databricks-clone-v1')
$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
$frontend = Join-Path $ProjectRoot 'frontend'
$head = & git -C $ProjectRoot rev-parse HEAD
if ($LASTEXITCODE -ne 0 -or $head.Trim() -ne 'fe0172bf38081c3e67e67c9c6322638585abbc2c') { throw 'Expected the accepted Settings Security release commit fe0172b before testing this uncommitted patch.' }
$inputs = @('backend/requirements.txt','backend/requirements-test.txt','backend/Dockerfile','backend/Dockerfile.test','docker-compose.test.yml','frontend/package.json','frontend/package-lock.json','frontend/vite.config.ts','frontend/vitest.config.ts','frontend/build/editorSanitizer.ts','frontend/build/verifyCloudApiBundle.mjs','frontend/scripts/build-vercel.mjs','vercel.json','backend/alembic/versions/20261017_0007_account_security.py','backend/scripts/rollout_account_security.py','backend/app/services/account_security.py','backend/app/services/email_verification.py','backend/app/core/csrf.py','backend/app/core/security.py','backend/app/db/session.py','backend/alembic/versions/20261017_0008_password_recovery.py')
$before = @{}
foreach ($relative in $inputs) { $before[$relative] = (Get-FileHash -LiteralPath (Join-Path $ProjectRoot $relative) -Algorithm SHA256).Hash }
Push-Location $ProjectRoot
try {
    & docker info --format '{{.ServerVersion}}'
    if ($LASTEXITCODE -ne 0) { throw 'Start Docker Desktop, wait until its engine is running, then rerun this verifier.' }
    $configText = & docker compose -f .\docker-compose.test.yml config --format json
    if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the disposable test configuration.' }
    $config = ($configText -join "`n") | ConvertFrom-Json
    $expected = 'postgresql+asyncpg://postgres:postgres@postgres-test:5432/databricks_clone_test'
    if ($config.services.'backend-tests'.environment.DATABASE_URL -ne $expected -or
        $config.services.'backend-test-api'.environment.DATABASE_URL -ne $expected -or
        $config.services.'backend-tests'.environment.TEST_DATABASE_URL -ne 'postgresql://postgres:postgres@postgres-test:5432/databricks_clone_test') {
        throw 'Unexpected test database configuration. No tests were run. Share this error without connection strings.'
    }
    & docker compose -f .\docker-compose.test.yml up -d --build --wait --wait-timeout 180 backend-test-api
    if ($LASTEXITCODE -ne 0) { throw 'Disposable test API startup failed. Stop and share the output.' }
    & docker compose -f .\docker-compose.test.yml run --build --rm --no-deps backend-tests python -m pytest -q
    if ($LASTEXITCODE -ne 0) { throw 'Backend tests failed. Stop here; do not deploy.' }
    Write-Host 'PASSWORD_RECOVERY_POSTGRES_TESTS=PASS'
    if (-not (Test-Path -LiteralPath (Join-Path $frontend 'node_modules/.bin/vitest.cmd'))) {
        & npm.cmd --prefix $frontend ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency installation failed.' }
    }
    & npm.cmd --prefix $frontend test -- --maxWorkers=2 --testTimeout=15000
    if ($LASTEXITCODE -ne 0) { throw 'Frontend tests failed. Stop here.' }
    & npm.cmd --prefix $frontend run lint
    if ($LASTEXITCODE -ne 0) { throw 'Frontend lint failed.' }
    & node (Join-Path $frontend 'scripts/build-vercel.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Cloud frontend build failed.' }
    & node (Join-Path $frontend 'scripts/verify-brand-assets.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Branding assets failed verification.' }
} finally {
    Pop-Location
    foreach ($relative in $inputs) {
        if ((Get-FileHash -LiteralPath (Join-Path $ProjectRoot $relative) -Algorithm SHA256).Hash -ne $before[$relative]) { throw ('Build/test input changed unexpectedly: ' + $relative) }
    }
}
Write-Host 'BUILD_INPUT_FILES_UNCHANGED=PASS'
Write-Host 'WINDOWS_PASSWORD_RECOVERY_CHECKS=PASS'
