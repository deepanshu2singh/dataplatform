param(
    [string]$ProjectRoot = (Get-Location).Path
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

$ReadmePath = Join-Path $ProjectRoot "README.md"
$StaleComposePath = Join-Path $ProjectRoot "frontend\docker-compose.yml"
$DevComposePath = Join-Path $ProjectRoot "docker-compose.yml"
$TestComposePath = Join-Path $ProjectRoot "docker-compose.test.yml"
$ProdComposePath = Join-Path $ProjectRoot "docker-compose.prod.yml"
$ProductionEnvPath = Join-Path $ProjectRoot "production.env"

$Expected = @{
    "frontend\docker-compose.yml" = "569A9D8E3BA256BCD402EFD751CD56FB04F7170D404BEB9E4A6A777270AE142F"
    "README.md" = "F4A049B89529E32047F528582F5A47F06E09AF2C7673FE3DA71E7B6598AEE78F"
    "docker-compose.yml" = "1896C28692A7C68405A54A0F2C745C14BBF25E60DF8F411D67705EFB8649943A"
    "docker-compose.test.yml" = "70A9192A44E74689B08E46ACEA8C44A643A73E45CFAD814D1C976FC59F48A5D8"
    "docker-compose.prod.yml" = "9EB5408452AC3E615B4E9348B2B912AD2783694E437EE1D418A0D7D6387A6A20"
    "production.env.example" = "5261323E7CB672E685E7D5ACECA4C37D77C71543BC2C1D61382C74EE45F22834"
    "scripts\verify-phase8F7-resource-governance.ps1" = "ABC956B9389C1DC67A5FEC2AAC8CBACA46B93D657D7616D08FDC9A32F771840A"
}

$ExpectedNewReadmeHash = "15FE763A279448E1B7719529EB4C6D5CFC59C1DCF592D81592A19ADEEBC2528D"

Write-Host ""
Write-Host "============================================================"
Write-Host "PHASE 8F.8 - DEPLOYMENT SURFACE CONSOLIDATION"
Write-Host "============================================================"

# ------------------------------------------------------------
# Baseline gate
# ------------------------------------------------------------

foreach ($RelativePath in $Expected.Keys) {

    $Path = Join-Path $ProjectRoot $RelativePath

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Baseline file missing: $RelativePath"
    }

    $ActualHash = (
        Get-FileHash -LiteralPath $Path -Algorithm SHA256
    ).Hash

    if ($ActualHash -ne $Expected[$RelativePath]) {
        throw "Baseline hash mismatch: $RelativePath"
    }

    Write-Host "PASS  baseline $RelativePath"
}

if (-not (Test-Path -LiteralPath $ProductionEnvPath -PathType Leaf)) {
    throw "production.env is required for production Compose validation."
}

Write-Host ""
Write-Host "PASS  authoritative Phase 8F.7 baseline"

# ------------------------------------------------------------
# Recovery copy
# ------------------------------------------------------------

$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"

$BackupDir = Join-Path (
    Join-Path $ProjectRoot "archive\phase8F8-pre-change"
) $Timestamp

New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null

$BackupReadme = Join-Path $BackupDir "README.md"
$BackupCompose = Join-Path $BackupDir "frontend-docker-compose.yml"

Copy-Item -LiteralPath $ReadmePath -Destination $BackupReadme -Force
Copy-Item -LiteralPath $StaleComposePath -Destination $BackupCompose -Force

Write-Host ""
Write-Host "Recovery copy:"
Write-Host "  $BackupDir"

# ------------------------------------------------------------
# Exact approved README payload
# ------------------------------------------------------------

$ReadmeBase64 = "IyBEYXRhUGxhdGZvcm0g4oCUIENsZWFuIFYxCgpBIGxvY2FsLWZpcnN0IGFuYWx5dGljcyBwbGF0Zm9ybSBwcm90b3R5cGUgd2l0aCBhdXRoZW50aWNhdGlvbiwgZGF0YXNldCB1cGxvYWRzLCBEdWNrREIgU1FMLCBub3RlYm9va3MsIGFuZCBkYXNoYm9hcmQgc2NhZmZvbGRpbmcuCgojIyBDdXJyZW50IFYxIHNjb3BlCgpXb3JraW5nIHRvd2FyZCB0aGlzIHZlcmlmaWVkIGZsb3c6CgoxLiBSZWdpc3Rlci9sb2dpbgoyLiBVcGxvYWQgYSBkYXRhc2V0CjMuIEluc3BlY3QgZGF0YXNldCBtZXRhZGF0YQo0LiBDcmVhdGUgYW5kIHNhdmUgYSBub3RlYm9vawo1LiBSdW4gU1FMIGFnYWluc3QgdGhlIHNlbGVjdGVkIGRhdGFzZXQKNi4gUmVvcGVuIHNhdmVkIHdvcmsKNy4gUGVyc2lzdCBkYXNoYm9hcmQgbGF5b3V0cy93aWRnZXRzCjguIEFkZCBpc29sYXRlZCBQeXRob24gZXhlY3V0aW9uCgpQeXRob24gZXhlY3V0aW9uIGlzICoqZGlzYWJsZWQgYnkgZGVmYXVsdCoqIHVudGlsIGl0IGlzIG1vdmVkIG91dCBvZiB0aGUgQVBJIGNvbnRhaW5lciBpbnRvIGFuIGlzb2xhdGVkIGV4ZWN1dGlvbiBlbnZpcm9ubWVudC4KCiMjIFN0YWNrCgotIEJhY2tlbmQ6IEZhc3RBUEkgKyBTUUxBbGNoZW15ICsgUG9zdGdyZVNRTAotIFNRTCBlbmdpbmU6IER1Y2tEQgotIEZyb250ZW5kOiBSZWFjdCArIFR5cGVTY3JpcHQgKyBWaXRlCi0gT3JjaGVzdHJhdGlvbjogRG9ja2VyIENvbXBvc2Ugd2l0aCBleHBsaWNpdCByb290IGRldmVsb3BtZW50LCB0ZXN0LCBhbmQgcHJvZHVjdGlvbiBlbnRyeXBvaW50cwoKIyMgQ2Fub25pY2FsIERvY2tlciBDb21wb3NlIGVudHJ5cG9pbnRzCgpSdW4gQ29tcG9zZSBjb21tYW5kcyBmcm9tIHRoZSByZXBvc2l0b3J5IHJvb3Qgb25seS4gVGhlIHN1cHBvcnRlZCBlbnRyeXBvaW50cyBhcmU6CgotIERldmVsb3BtZW50OiBgZG9ja2VyLWNvbXBvc2UueW1sYAotIFRlc3RzOiBgZG9ja2VyLWNvbXBvc2UudGVzdC55bWxgCi0gUHJvZHVjdGlvbjogYGRvY2tlci1jb21wb3NlLnByb2QueW1sYCB3aXRoIGBwcm9kdWN0aW9uLmVudmAKCkRvIG5vdCBhZGQgb3IgaW52b2tlIG5lc3RlZCBDb21wb3NlIGZpbGVzIHVuZGVyIGBiYWNrZW5kL2Agb3IgYGZyb250ZW5kL2AuCgpQcm9kdWN0aW9uIHN0YXJ0dXA6CgpgYGBwb3dlcnNoZWxsCmRvY2tlciBjb21wb3NlIC0tZW52LWZpbGUgLlxwcm9kdWN0aW9uLmVudiAtZiAuXGRvY2tlci1jb21wb3NlLnByb2QueW1sIHVwIC1kCmBgYAoKVGhlIGN1cnJlbnQgSFRUUFMvQ2FkZHkgZWRnZSByZW1haW5zIG1hbmFnZWQgc2VwYXJhdGVseSBmcm9tIHRoZSBwcm9kdWN0aW9uIENvbXBvc2Ugc3RhY2suCgojIyBRdWljayBzdGFydCDigJQgV2luZG93cyAvIERvY2tlciBEZXNrdG9wCgpgYGBwb3dlcnNoZWxsCkNvcHktSXRlbSAuZW52LmV4YW1wbGUgLmVudgpweXRob24gLWMgImltcG9ydCBzZWNyZXRzOyBwcmludChzZWNyZXRzLnRva2VuX3VybHNhZmUoNDgpKSIKYGBgCgpQYXN0ZSB0aGUgZ2VuZXJhdGVkIHZhbHVlIGludG8gYC5lbnZgIGFzIGBTRUNSRVRfS0VZPS4uLmAsIHRoZW46CgpgYGBwb3dlcnNoZWxsCmRvY2tlciBjb21wb3NlIGJ1aWxkIC0tbm8tY2FjaGUKZG9ja2VyIGNvbXBvc2UgdXAKYGBgCgpPcGVuOgoKLSBBcHA6IGh0dHA6Ly9sb2NhbGhvc3Q6NTE3MwotIEJhY2tlbmQgaGVhbHRoOiBodHRwOi8vbG9jYWxob3N0OjgwMDAvaGVhbHRoCi0gU3dhZ2dlciBVSTogaHR0cDovL2xvY2FsaG9zdDo4MDAwL2RvY3MKLSBPcGVuQVBJIEpTT046IGh0dHA6Ly9sb2NhbGhvc3Q6ODAwMC9hcGkvdjEvb3BlbmFwaS5qc29uCgojIyBQcm9qZWN0IHN0cnVjdHVyZQoKYGBgdGV4dApiYWNrZW5kLwogIGFwcC8KICAgIGFwaS9yb3V0ZXMvCiAgICBjb3JlLwogICAgZGIvCiAgICBtb2RlbHMvCiAgICBzY2hlbWFzLwogICAgc2VydmljZXMvCmZyb250ZW5kLwogIHNyYy8KZG9ja2VyLWNvbXBvc2UueW1sICAgICAgICMgZGV2ZWxvcG1lbnQKZG9ja2VyLWNvbXBvc2UudGVzdC55bWwgICMgdGVzdHMKZG9ja2VyLWNvbXBvc2UucHJvZC55bWwgICMgcHJvZHVjdGlvbgpWMV9SRVBBSVJfR1VJREUubWQKYGBgCgojIyBTYWZldHkKClVzZSBgZG9ja2VyLWNvbXBvc2UueW1sYCBvbmx5IGZvciBsb2NhbCBkZXZlbG9wbWVudCBhbmQgYGRvY2tlci1jb21wb3NlLnRlc3QueW1sYCBvbmx5IGZvciBpc29sYXRlZCB0ZXN0cy4gUHJvZHVjdGlvbiBkZXBsb3ltZW50cyB1c2UgYGRvY2tlci1jb21wb3NlLnByb2QueW1sYCB3aXRoIHRoZSBwcm9kdWN0aW9uIGVudmlyb25tZW50IGZpbGUgYW5kIHRoZSBhY2NlcHRlZCBoYXJkZW5pbmcgY29udHJvbHMuIFB5dGhvbiBleGVjdXRpb24gcmVtYWlucyBkaXNhYmxlZCBieSBkZWZhdWx0IHVudGlsIGl0IGlzIG1vdmVkIGludG8gYW4gaXNvbGF0ZWQgZXhlY3V0aW9uIGVudmlyb25tZW50Lgo="

try {

    # Write deterministic README.
    $ReadmeBytes = [System.Convert]::FromBase64String($ReadmeBase64)
    [System.IO.File]::WriteAllBytes($ReadmePath, $ReadmeBytes)

    $NewReadmeHash = (
        Get-FileHash -LiteralPath $ReadmePath -Algorithm SHA256
    ).Hash

    if ($NewReadmeHash -ne $ExpectedNewReadmeHash) {
        throw "Approved README hash verification failed."
    }

    Write-Host ""
    Write-Host "PASS  README.md"
    Write-Host "      $NewReadmeHash"

    # Delete only the obsolete nested Compose file.
    Remove-Item -LiteralPath $StaleComposePath -Force

    if (Test-Path -LiteralPath $StaleComposePath) {
        throw "frontend\docker-compose.yml still exists."
    }

    Write-Host "PASS  removed frontend\docker-compose.yml"

    # Confirm no active nested Compose file remains.
    $NestedComposeFiles = @()

    foreach ($SearchRoot in @(
        (Join-Path $ProjectRoot "frontend"),
        (Join-Path $ProjectRoot "backend")
    )) {

        if (Test-Path -LiteralPath $SearchRoot) {

            $NestedComposeFiles += @(
                Get-ChildItem `
                    -LiteralPath $SearchRoot `
                    -Recurse `
                    -File `
                    -Filter "docker-compose*.yml"
            )
        }
    }

    if ($NestedComposeFiles.Count -ne 0) {

        foreach ($File in $NestedComposeFiles) {
            Write-Host "UNEXPECTED  $($File.FullName)"
        }

        throw "Nested Compose entrypoint remains."
    }

    Write-Host "PASS  no nested backend/frontend Compose entrypoints"

    # Confirm protected Phase 8F.7 files did not drift.
    foreach ($RelativePath in @(
        "docker-compose.yml",
        "docker-compose.test.yml",
        "docker-compose.prod.yml",
        "production.env.example",
        "scripts\verify-phase8F7-resource-governance.ps1"
    )) {

        $Path = Join-Path $ProjectRoot $RelativePath

        $ActualHash = (
            Get-FileHash -LiteralPath $Path -Algorithm SHA256
        ).Hash

        if ($ActualHash -ne $Expected[$RelativePath]) {
            throw "Unexpected drift detected: $RelativePath"
        }

        Write-Host "PASS  unchanged $RelativePath"
    }

    # Validate the three canonical root Compose entrypoints.
    Write-Host ""
    Write-Host "Validating development Compose..."

    & docker compose -f $DevComposePath config --quiet

    if ($LASTEXITCODE -ne 0) {
        throw "Development Compose validation failed."
    }

    Write-Host "PASS  docker-compose.yml"

    Write-Host ""
    Write-Host "Validating test Compose..."

    & docker compose -f $TestComposePath config --quiet

    if ($LASTEXITCODE -ne 0) {
        throw "Test Compose validation failed."
    }

    Write-Host "PASS  docker-compose.test.yml"

    Write-Host ""
    Write-Host "Validating production Compose..."

    & docker compose `
        --env-file $ProductionEnvPath `
        -f $ProdComposePath `
        config `
        --quiet

    if ($LASTEXITCODE -ne 0) {
        throw "Production Compose validation failed."
    }

    Write-Host "PASS  docker-compose.prod.yml"
}
catch {

    $OriginalError = $_

    Write-Host ""
    Write-Host "============================================================"
    Write-Host "PHASE 8F.8 SOURCE CHANGE FAILED - ROLLING BACK"
    Write-Host "============================================================"

    Copy-Item -LiteralPath $BackupReadme -Destination $ReadmePath -Force
    Copy-Item -LiteralPath $BackupCompose -Destination $StaleComposePath -Force

    $RestoredReadmeHash = (
        Get-FileHash -LiteralPath $ReadmePath -Algorithm SHA256
    ).Hash

    $RestoredComposeHash = (
        Get-FileHash -LiteralPath $StaleComposePath -Algorithm SHA256
    ).Hash

    if ($RestoredReadmeHash -ne $Expected["README.md"]) {
        throw "ROLLBACK FAILURE: README.md was not restored exactly."
    }

    if ($RestoredComposeHash -ne $Expected["frontend\docker-compose.yml"]) {
        throw "ROLLBACK FAILURE: frontend Compose was not restored exactly."
    }

    Write-Host ""
    Write-Host "PASS  rollback restored README.md"
    Write-Host "PASS  rollback restored frontend\docker-compose.yml"
    Write-Host ""
    Write-Host "Project returned to authoritative Phase 8F.7 source state."

    throw $OriginalError
}

Write-Host ""
Write-Host "============================================================"
Write-Host "PHASE 8F.8 SOURCE GATE: PASS"
Write-Host "============================================================"

Write-Host ""
Write-Host "Changed:"
Write-Host "  README.md"

Write-Host ""
Write-Host "Removed:"
Write-Host "  frontend\docker-compose.yml"

Write-Host ""
Write-Host "README SHA-256:"
Write-Host "  $NewReadmeHash"

Write-Host ""
Write-Host "Production Compose SHA-256:"
Write-Host "  $($Expected["docker-compose.prod.yml"])"

Write-Host ""
Write-Host "Recovery copy:"
Write-Host "  $BackupDir"

Write-Host ""
Write-Host "Docker containers changed: NO"
Write-Host "Database changed:         NO"
Write-Host "Browser regression:       NOT REQUIRED"
Write-Host "============================================================"