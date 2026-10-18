param([string]$ProjectRoot = 'D:\New project\databricks-clone-v1')
$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
$head = & git -C $ProjectRoot rev-parse HEAD
if ($LASTEXITCODE -ne 0 -or ($head -join '').Trim() -ne 'c3db1b1e413f41b7bb4829645e98c81365bc694c') { throw 'Expected the accepted Settings Data commit c3db1b1. Stop and share your Git state.' }
$tracked = @(& git -C $ProjectRoot ls-files)
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect tracked input files.' }
$extra = @('frontend/src/lib/privacy.ts','frontend/src/components/PrivacyLink.tsx','frontend/src/components/PrivacyLink.test.tsx','frontend/src/components/ThemeStorageControl.tsx','frontend/src/pages/PrivacyPage.tsx','frontend/src/pages/PrivacyPage.css','frontend/src/pages/PrivacyPage.test.tsx','frontend/src/PrivacyRouting.test.tsx','docs/phases/cloud/CLOUD_PRIVACY_INFORMATION.md','docs/phases/cloud/CLOUD_PRIVACY_INFORMATION_VALIDATION.json','scripts/verify-cloud-privacy-information.ps1')
$inputs = @($tracked + $extra | Sort-Object -Unique)
$before = @{}
foreach ($relative in $inputs) {
    $path = Join-Path $ProjectRoot $relative
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw ('Missing phase input: ' + $relative) }
    $before[$relative] = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
}
$frontend = Join-Path $ProjectRoot 'frontend'
$tests = @('src/components/ThemeProvider.test.tsx','src/components/PrivacyLink.test.tsx','src/pages/PrivacyPage.test.tsx','src/PrivacyRouting.test.tsx','src/pages/SettingsPage.test.tsx','src/components/AccountData.test.tsx','src/components/AccountAccess.test.tsx','src/components/Layout.test.tsx','src/pages/LoginPage.test.tsx','src/pages/RegisterPage.test.tsx','src/pages/VerifyEmailPage.test.tsx','src/pages/ForgotPasswordPage.test.tsx','src/pages/DatasetsPage.test.tsx','src/lib/datasetUpload.test.ts','src/contexts/AuthContext.test.tsx')
try {
    if (-not (Test-Path -LiteralPath (Join-Path $frontend 'node_modules/.bin/vitest.cmd'))) {
        & npm.cmd --prefix $frontend ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. Stop here.' }
    }
    & npm.cmd --prefix $frontend test -- --maxWorkers=2 --testTimeout=15000 @tests
    if ($LASTEXITCODE -ne 0) { throw 'Focused frontend tests failed. Stop here; do not deploy.' }
    & npm.cmd --prefix $frontend run lint
    if ($LASTEXITCODE -ne 0) { throw 'Frontend lint failed. Stop here.' }
    & node (Join-Path $frontend 'scripts/build-vercel.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Cloud frontend build failed. Stop here.' }
    & node (Join-Path $frontend 'scripts/verify-brand-assets.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Branding verification failed. Stop here.' }
} finally {
    foreach ($relative in $inputs) {
        $path = Join-Path $ProjectRoot $relative
        if (-not (Test-Path -LiteralPath $path -PathType Leaf) -or
            (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $before[$relative]) {
            throw ('Build/test input changed unexpectedly: ' + $relative)
        }
    }
}
$record = Join-Path (Join-Path $ProjectRoot 'checkpoints') ('cloud-privacy-information-checks-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Path $record -Force | Out-Null
@{ status='PASS'; phase='privacy-information'; head=($head -join '').Trim(); input_files_unchanged=$true; test_files=$tests; production_changes='NONE'; visual_live_checks='PENDING' } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $record 'RESULTS.json') -Encoding UTF8
Write-Host 'BUILD_INPUT_FILES_UNCHANGED=PASS'
Write-Host 'WINDOWS_PRIVACY_INFORMATION_CHECKS=PASS'
Write-Host ('VERIFICATION_RECORD=' + (Join-Path $record 'RESULTS.json'))
Write-Host 'No migration, deployment, Git commit, push or cloud cleanup was run. Share the final output.'
