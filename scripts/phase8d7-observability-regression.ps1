$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $ProjectRoot

function Assert-ExitCode([string]$Step) {
    if ($LASTEXITCODE -ne 0) {
        throw "$Step failed with exit code $LASTEXITCODE"
    }
}

try {
    Write-Host "[8D.7] Resetting disposable backend test stack..."
    docker compose -f docker-compose.test.yml down -v
    Assert-ExitCode "test stack cleanup"

    docker compose -f docker-compose.test.yml up -d --build backend-test-api
    Assert-ExitCode "test API startup"

    Write-Host "[8D.7] Running focused backend observability regression..."
    docker compose -f docker-compose.test.yml run --rm --build backend-tests `
      python -m pytest -q `
      tests/test_observability.py `
      tests/test_error_handling.py `
      tests/test_log_redaction.py `
      tests/test_domain_logging.py `
      tests/test_health_readiness.py `
      tests/test_observability_regression.py
    Assert-ExitCode "backend observability regression"

    Write-Host "[8D.7] Running focused frontend recovery regression..."
    Push-Location frontend
    try {
        npm test -- `
          src/lib/apiError.test.ts `
          src/components/AppErrorBoundary.test.tsx `
          src/pages/DatasetsPage.test.tsx
        Assert-ExitCode "frontend observability regression"

        npx tsc -b
        Assert-ExitCode "frontend TypeScript"
    }
    finally {
        Pop-Location
    }

    Write-Host "[8D.7] Focused observability regression passed."
}
finally {
    docker compose -f docker-compose.test.yml down -v
    Pop-Location
}
