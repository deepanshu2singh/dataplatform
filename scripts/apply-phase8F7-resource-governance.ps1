param(
    [string]$ProjectRoot = (Get-Location).Path
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path

$ComposePath = Join-Path $ProjectRoot "docker-compose.prod.yml"
$EnvExamplePath = Join-Path $ProjectRoot "production.env.example"
$ProductionEnvPath = Join-Path $ProjectRoot "production.env"

$BaselineComposeHash =
    "C14B8ED1A47EB8CF830EC7C140E8CBB87D0E7D184D8DECBA574466B11CD6B67B"

$BaselineEnvHash =
    "D50B409CF76B4CCE3992CDA8E9EA79F385838A479BCD675DFCBEC6BC3E6FBA3D"

$ExpectedComposeHash =
    "9EB5408452AC3E615B4E9348B2B912AD2783694E437EE1D418A0D7D6387A6A20"

$ExpectedEnvHash =
    "5261323E7CB672E685E7D5ACECA4C37D77C71543BC2C1D61382C74EE45F22834"

Write-Host ""
Write-Host "============================================================"
Write-Host "PHASE 8F.7 - PRODUCTION RESOURCE GOVERNANCE"
Write-Host "SOURCE CHANGE"
Write-Host "============================================================"

# ============================================================
# PRE-FLIGHT
# ============================================================

foreach ($Path in @(
    $ComposePath,
    $EnvExamplePath,
    $ProductionEnvPath
)) {
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "Required file missing: $Path"
    }
}

$CurrentComposeHash = (
    Get-FileHash $ComposePath -Algorithm SHA256
).Hash

$CurrentEnvHash = (
    Get-FileHash $EnvExamplePath -Algorithm SHA256
).Hash

Write-Host ""
Write-Host "Current production Compose SHA-256:"
Write-Host "  $CurrentComposeHash"

Write-Host ""
Write-Host "Current production.env.example SHA-256:"
Write-Host "  $CurrentEnvHash"

if ($CurrentComposeHash -ne $BaselineComposeHash) {
    throw @"
SOURCE GATE FAILED.

docker-compose.prod.yml is not the authoritative
Phase 8F.6 baseline.

Expected:
$BaselineComposeHash

Found:
$CurrentComposeHash
"@
}

if ($CurrentEnvHash -ne $BaselineEnvHash) {
    throw @"
SOURCE GATE FAILED.

production.env.example is not the authoritative
Phase 8F.6 baseline.

Expected:
$BaselineEnvHash

Found:
$CurrentEnvHash
"@
}

Write-Host ""
Write-Host "Authoritative Phase 8F.6 baseline confirmed."

# ============================================================
# BACKUP
# ============================================================

$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"

$BackupDir = Join-Path `
    $ProjectRoot `
    "archive\phase8F7-pre-change\$Timestamp"

New-Item `
    -ItemType Directory `
    -Path $BackupDir `
    -Force |
    Out-Null

$BackupCompose = Join-Path `
    $BackupDir `
    "docker-compose.prod.yml"

$BackupEnv = Join-Path `
    $BackupDir `
    "production.env.example"

Copy-Item $ComposePath $BackupCompose -Force
Copy-Item $EnvExamplePath $BackupEnv -Force

Write-Host ""
Write-Host "Recovery copy:"
Write-Host "  $BackupDir"

# ============================================================
# HELPERS
# ============================================================

function Get-NewLine {
    param([string]$Text)

    if ($Text.Contains("`r`n")) {
        return "`r`n"
    }

    return "`n"
}


function Add-ServicePolicy {

    param(
        [string]$Text,
        [string]$Service,
        [string]$Cpu,
        [string]$Memory,
        [string]$Pids
    )

    $NewLine = Get-NewLine -Text $Text

    $Pattern =
        "(?m)^  " +
        [Regex]::Escape($Service) +
        ":\r?$"

    $Regex = New-Object `
        System.Text.RegularExpressions.Regex(
            $Pattern,
            [System.Text.RegularExpressions.RegexOptions]::Multiline
        )

    $Matches = $Regex.Matches($Text)

    if ($Matches.Count -ne 1) {
        throw @"
Could not uniquely locate service:

$Service

Matches found:
$($Matches.Count)
"@
    }

    $Match = $Matches[0]

    # Reject duplicate application.
    $NextText = $Text.Substring(
        $Match.Index + $Match.Length
    )

    $NextServiceMatch = [Regex]::Match(
        $NextText,
        "(?m)^  [A-Za-z0-9_.-]+:\r?$"
    )

    if ($NextServiceMatch.Success) {
        $ServiceBody = $NextText.Substring(
            0,
            $NextServiceMatch.Index
        )
    }
    else {
        $ServiceBody = $NextText
    }

    if (
        $ServiceBody -match
        "(?m)^    (cpus|mem_limit|pids_limit):"
    ) {
        throw "Resource policy already exists for service: $Service"
    }

    $Header = "  ${Service}:"

    $Policy = @(
        "    cpus: $Cpu",
        "    mem_limit: $Memory",
        "    pids_limit: $Pids"
    ) -join $NewLine

    $Replacement =
        $Header +
        $NewLine +
        $Policy

    return (
        $Text.Substring(
            0,
            $Match.Index
        ) +
        $Replacement +
        $Text.Substring(
            $Match.Index + $Match.Length
        )
    )
}


function Convert-MemoryToBytes {

    param($Value)

    $Text = ([string]$Value).Trim()

    if ($Text -match "^[0-9]+$") {
        return [int64]$Text
    }

    if (
        $Text -match
        "^(?<n>[0-9]+(?:\.[0-9]+)?)(?<u>[kKmMgGtT])(?:i?[bB])?$"
    ) {
        $Number = [double]$Matches["n"]
        $Unit = $Matches["u"].ToLowerInvariant()

        switch ($Unit) {
            "k" { $Multiplier = 1KB }
            "m" { $Multiplier = 1MB }
            "g" { $Multiplier = 1GB }
            "t" { $Multiplier = 1TB }
            default {
                throw "Unsupported memory value: $Text"
            }
        }

        return [int64][Math]::Round(
            $Number * $Multiplier
        )
    }

    throw "Cannot parse memory value: $Text"
}


function Assert-ServicePolicy {

    param(
        $Model,
        [string]$ServiceName,
        [double]$Cpu,
        [int64]$MemoryBytes,
        [int]$Pids
    )

    $Property =
        $Model.services.PSObject.Properties[
            $ServiceName
        ]

    if ($null -eq $Property) {
        throw "Rendered Compose missing service: $ServiceName"
    }

    $Service = $Property.Value

    $ActualCpu = [double]$Service.cpus

    $ActualMemory =
        Convert-MemoryToBytes `
            $Service.mem_limit

    $ActualPids =
        [int]$Service.pids_limit

    if (
        [Math]::Abs(
            $ActualCpu - $Cpu
        ) -gt 0.0001
    ) {
        throw "$ServiceName CPU limit validation failed."
    }

    if ($ActualMemory -ne $MemoryBytes) {
        throw "$ServiceName memory limit validation failed."
    }

    if ($ActualPids -ne $Pids) {
        throw "$ServiceName PID limit validation failed."
    }
}

# ============================================================
# APPLY CHANGE
# ============================================================

try {

    $Compose = [System.IO.File]::ReadAllText(
        $ComposePath
    )

    $Compose = Add-ServicePolicy `
        -Text $Compose `
        -Service "postgres" `
        -Cpu '${POSTGRES_CPUS:-1.0}' `
        -Memory '${POSTGRES_MEMORY_LIMIT:-512m}' `
        -Pids '${POSTGRES_PIDS_LIMIT:-128}'

    $Compose = Add-ServicePolicy `
        -Text $Compose `
        -Service "migrate" `
        -Cpu '${MIGRATE_CPUS:-1.0}' `
        -Memory '${MIGRATE_MEMORY_LIMIT:-384m}' `
        -Pids '${MIGRATE_PIDS_LIMIT:-64}'

    $Compose = Add-ServicePolicy `
        -Text $Compose `
        -Service "backend" `
        -Cpu '${BACKEND_CPUS:-2.0}' `
        -Memory '${BACKEND_MEMORY_LIMIT:-1536m}' `
        -Pids '${BACKEND_PIDS_LIMIT:-128}'

    $Compose = Add-ServicePolicy `
        -Text $Compose `
        -Service "frontend" `
        -Cpu '${FRONTEND_CPUS:-0.5}' `
        -Memory '${FRONTEND_MEMORY_LIMIT:-256m}' `
        -Pids '${FRONTEND_PIDS_LIMIT:-64}'

    $EnvExample = [System.IO.File]::ReadAllText(
        $EnvExamplePath
    )

    if (
        $EnvExample.Contains(
            "# Phase 8F.7 production resource governance"
        )
    ) {
        throw "Phase 8F.7 settings already exist in production.env.example."
    }

    $NewLine = Get-NewLine -Text $EnvExample

    $ResourceBlock = @(
        "# Phase 8F.7 production resource governance",
        "# Safe defaults validated on the current Docker Desktop host.",
        "# Override only when deploying to a differently sized host.",
        "",
        "POSTGRES_CPUS=1.0",
        "POSTGRES_MEMORY_LIMIT=512m",
        "POSTGRES_PIDS_LIMIT=128",
        "",
        "MIGRATE_CPUS=1.0",
        "MIGRATE_MEMORY_LIMIT=384m",
        "MIGRATE_PIDS_LIMIT=64",
        "",
        "BACKEND_CPUS=2.0",
        "BACKEND_MEMORY_LIMIT=1536m",
        "BACKEND_PIDS_LIMIT=128",
        "",
        "FRONTEND_CPUS=0.5",
        "FRONTEND_MEMORY_LIMIT=256m",
        "FRONTEND_PIDS_LIMIT=64"
    ) -join $NewLine

    $TrimChars = [char[]]@(
        [char]13,
        [char]10
    )

    $EnvExample =
        $EnvExample.TrimEnd($TrimChars) +
        $NewLine +
        $NewLine +
        $ResourceBlock +
        $NewLine

    # Preserve authoritative UTF-8 without BOM.
    $Utf8NoBom =
        New-Object System.Text.UTF8Encoding($false)

    [System.IO.File]::WriteAllText(
        $ComposePath,
        $Compose,
        $Utf8NoBom
    )

    [System.IO.File]::WriteAllText(
        $EnvExamplePath,
        $EnvExample,
        $Utf8NoBom
    )

    # ========================================================
    # DETERMINISTIC HASH GATE
    # ========================================================

    $NewComposeHash = (
        Get-FileHash `
            $ComposePath `
            -Algorithm SHA256
    ).Hash

    $NewEnvHash = (
        Get-FileHash `
            $EnvExamplePath `
            -Algorithm SHA256
    ).Hash

    Write-Host ""
    Write-Host "Candidate docker-compose.prod.yml SHA-256:"
    Write-Host "  $NewComposeHash"

    Write-Host ""
    Write-Host "Candidate production.env.example SHA-256:"
    Write-Host "  $NewEnvHash"

    if ($NewComposeHash -ne $ExpectedComposeHash) {
        throw @"
Compose result does not match the designed Phase 8F.7 source.

Expected:
$ExpectedComposeHash

Found:
$NewComposeHash
"@
    }

    if ($NewEnvHash -ne $ExpectedEnvHash) {
        throw @"
production.env.example does not match the designed
Phase 8F.7 source.

Expected:
$ExpectedEnvHash

Found:
$NewEnvHash
"@
    }

    # ========================================================
    # COMPOSE VALIDATION
    # ========================================================

    Write-Host ""
    Write-Host "Validating Compose syntax..."

    & docker compose `
        --env-file $ProductionEnvPath `
        -f $ComposePath `
        config `
        --quiet

    if ($LASTEXITCODE -ne 0) {
        throw "docker compose config validation failed."
    }

    Write-Host "PASS  Compose syntax"

    # ========================================================
    # RENDERED MODEL VALIDATION
    # ========================================================

    Write-Host ""
    Write-Host "Validating resolved resource policy..."

    $JsonLines = & docker compose `
        --env-file $ProductionEnvPath `
        -f $ComposePath `
        config `
        --format json

    if ($LASTEXITCODE -ne 0) {
        throw "Could not render Compose JSON model."
    }

    $Model = (
        $JsonLines -join "`n"
    ) | ConvertFrom-Json

    Assert-ServicePolicy `
        -Model $Model `
        -ServiceName "postgres" `
        -Cpu 1.0 `
        -MemoryBytes 536870912 `
        -Pids 128

    Assert-ServicePolicy `
        -Model $Model `
        -ServiceName "migrate" `
        -Cpu 1.0 `
        -MemoryBytes 402653184 `
        -Pids 64

    Assert-ServicePolicy `
        -Model $Model `
        -ServiceName "backend" `
        -Cpu 2.0 `
        -MemoryBytes 1610612736 `
        -Pids 128

    Assert-ServicePolicy `
        -Model $Model `
        -ServiceName "frontend" `
        -Cpu 0.5 `
        -MemoryBytes 268435456 `
        -Pids 64

    Write-Host "PASS  postgres limits"
    Write-Host "PASS  migrate limits"
    Write-Host "PASS  backend limits"
    Write-Host "PASS  frontend limits"
}
catch {

    Write-Host ""
    Write-Host "============================================================"
    Write-Host "PHASE 8F.7 SOURCE CHANGE FAILED"
    Write-Host "ROLLING BACK"
    Write-Host "============================================================"

    Copy-Item `
        $BackupCompose `
        $ComposePath `
        -Force

    Copy-Item `
        $BackupEnv `
        $EnvExamplePath `
        -Force

    $RollbackComposeHash = (
        Get-FileHash `
            $ComposePath `
            -Algorithm SHA256
    ).Hash

    $RollbackEnvHash = (
        Get-FileHash `
            $EnvExamplePath `
            -Algorithm SHA256
    ).Hash

    Write-Host ""
    Write-Host "Rollback Compose SHA-256:"
    Write-Host "  $RollbackComposeHash"

    Write-Host ""
    Write-Host "Rollback env-example SHA-256:"
    Write-Host "  $RollbackEnvHash"

    Write-Host ""
    Write-Host "SOURCE ROLLBACK COMPLETE."
    Write-Host ""

    throw
}

# ============================================================
# PASS
# ============================================================

Write-Host ""
Write-Host "============================================================"
Write-Host "PHASE 8F.7 SOURCE GATE: PASS"
Write-Host "============================================================"

Write-Host ""
Write-Host "docker-compose.prod.yml:"
Write-Host "  $NewComposeHash"

Write-Host ""
Write-Host "production.env.example:"
Write-Host "  $NewEnvHash"

Write-Host ""
Write-Host "Resource policy:"
Write-Host "  postgres  CPU=1.0  MEM=512m   PIDS=128"
Write-Host "  migrate   CPU=1.0  MEM=384m   PIDS=64"
Write-Host "  backend   CPU=2.0  MEM=1536m  PIDS=128"
Write-Host "  frontend  CPU=0.5  MEM=256m   PIDS=64"

Write-Host ""
Write-Host "Recovery copy:"
Write-Host "  $BackupDir"

Write-Host ""
Write-Host "DEPLOYMENT HAS NOT BEEN PERFORMED."
Write-Host "============================================================"