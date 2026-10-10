param(
    [string]$ProjectRoot = (Get-Location).Path
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ============================================================
# PHASE 8F.7 FULL CHECKPOINT CREATOR
# Windows PowerShell 5.1 compatible
# ============================================================

$ProjectRoot = (
    Resolve-Path -LiteralPath $ProjectRoot
).Path

$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

$CheckpointDir = Join-Path `
    $ProjectRoot `
    "checkpoints"

$CheckpointName = "phase8F7-complete"

$ZipPath = Join-Path `
    $CheckpointDir `
    "$CheckpointName.zip"

$HashPath = Join-Path `
    $CheckpointDir `
    "$CheckpointName.sha256.txt"

$BaselineZip = Join-Path `
    $CheckpointDir `
    "phase8F6-complete.zip"

$ComposePath = Join-Path `
    $ProjectRoot `
    "docker-compose.prod.yml"

$EnvExamplePath = Join-Path `
    $ProjectRoot `
    "production.env.example"

$VerifierPath = Join-Path `
    $ProjectRoot `
    "scripts\verify-phase8F7-resource-governance.ps1"

$ApplyScriptPath = Join-Path `
    $ProjectRoot `
    "scripts\apply-phase8F7-resource-governance.ps1"

$CreatorPath = Join-Path `
    $ProjectRoot `
    "scripts\create-phase8F7-full-checkpoint.ps1"

$ReadmePath = Join-Path `
    $ProjectRoot `
    "README.md"

# ------------------------------------------------------------
# Approved hashes
# ------------------------------------------------------------

$ExpectedBaselineCheckpointHash =
    "210537667758EA1E74B08086C6A81C03E755C2032BE4926C0042162304CDF2C5"

$ExpectedComposeHash =
    "9EB5408452AC3E615B4E9348B2B912AD2783694E437EE1D418A0D7D6387A6A20"

$ExpectedEnvExampleHash =
    "5261323E7CB672E685E7D5ACECA4C37D77C71543BC2C1D61382C74EE45F22834"

$ExpectedReadmeHash =
    "F4A049B89529E32047F528582F5A47F06E09AF2C7673FE3DA71E7B6598AEE78F"

$ExpectedPhase8F6CompletionHash =
    "D1C07EC02865FAC30907B67186027E208EBDA327A78094ADB9EA60BFBA7DE1BF"

# ============================================================
# COMPATIBILITY HELPERS
# ============================================================

function Get-RelativePathCompat {

    param(
        [Parameter(Mandatory = $true)]
        [string]$BasePath,

        [Parameter(Mandatory = $true)]
        [string]$TargetPath
    )

    $BaseFull = [System.IO.Path]::GetFullPath(
        $BasePath
    )

    if (-not $BaseFull.EndsWith("\")) {
        $BaseFull += "\"
    }

    $TargetFull = [System.IO.Path]::GetFullPath(
        $TargetPath
    )

    if (
        -not $TargetFull.StartsWith(
            $BaseFull,
            [System.StringComparison]::OrdinalIgnoreCase
        )
    ) {
        throw "Target path is outside project root: $TargetFull"
    }

    return $TargetFull.Substring(
        $BaseFull.Length
    )
}


function Write-Utf8NoBom {

    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$Text
    )

    [System.IO.File]::WriteAllText(
        $Path,
        $Text,
        $Utf8NoBom
    )
}


function Get-ZipEntryText {

    param(
        [Parameter(Mandatory = $true)]
        $ZipArchive,

        [Parameter(Mandatory = $true)]
        [string]$EntryName
    )

    $Entry = $ZipArchive.GetEntry(
        $EntryName
    )

    if ($null -eq $Entry) {
        throw "Required baseline ZIP entry missing: $EntryName"
    }

    $Stream = $null
    $Reader = $null

    try {

        $Stream = $Entry.Open()

        $Reader = New-Object `
            System.IO.StreamReader($Stream)

        return $Reader.ReadToEnd()
    }
    finally {

        if ($null -ne $Reader) {
            $Reader.Dispose()
        }
        elseif ($null -ne $Stream) {
            $Stream.Dispose()
        }
    }
}


function Extract-ZipEntry {

    param(
        [Parameter(Mandatory = $true)]
        $ZipArchive,

        [Parameter(Mandatory = $true)]
        [string]$EntryName,

        [Parameter(Mandatory = $true)]
        [string]$Destination
    )

    $Entry = $ZipArchive.GetEntry(
        $EntryName
    )

    if ($null -eq $Entry) {
        throw "Required baseline ZIP entry missing: $EntryName"
    }

    $DestinationDirectory =
        Split-Path `
            -Parent `
            $Destination

    New-Item `
        -ItemType Directory `
        -Path $DestinationDirectory `
        -Force |
        Out-Null

    $InputStream = $null
    $OutputStream = $null

    try {

        $InputStream = $Entry.Open()

        $OutputStream = [System.IO.File]::Open(
            $Destination,
            [System.IO.FileMode]::Create,
            [System.IO.FileAccess]::Write,
            [System.IO.FileShare]::None
        )

        $InputStream.CopyTo(
            $OutputStream
        )
    }
    finally {

        if ($null -ne $OutputStream) {
            $OutputStream.Dispose()
        }

        if ($null -ne $InputStream) {
            $InputStream.Dispose()
        }
    }
}

# ============================================================
# PRE-FLIGHT
# ============================================================

Write-Host ""
Write-Host "============================================================"
Write-Host "PHASE 8F.7 FULL CHECKPOINT - PRE-FLIGHT"
Write-Host "============================================================"

$RequiredPaths = @(
    "backend",
    "frontend",
    "scripts",
    "docs\phases",
    "docker-compose.prod.yml",
    "docker-compose.yml",
    "docker-compose.test.yml",
    "production.env.example",
    "Caddyfile.local",
    "README.md",
    "scripts\apply-phase8F7-resource-governance.ps1",
    "scripts\verify-phase8F7-resource-governance.ps1",
    "scripts\create-phase8F7-full-checkpoint.ps1",
    "checkpoints\phase8F6-complete.zip"
)

foreach ($RelativePath in $RequiredPaths) {

    $FullPath = Join-Path `
        $ProjectRoot `
        $RelativePath

    if (-not (Test-Path -LiteralPath $FullPath)) {
        throw "Checkpoint safety check FAILED. Missing: $RelativePath"
    }

    Write-Host "OK  $RelativePath"
}

# ============================================================
# AUTHORITATIVE PARENT CHECKPOINT
# ============================================================

$BaselineCheckpointHash = (
    Get-FileHash `
        -LiteralPath $BaselineZip `
        -Algorithm SHA256
).Hash

Write-Host ""
Write-Host "Phase 8F.6 parent checkpoint:"
Write-Host "  $BaselineCheckpointHash"

if (
    $BaselineCheckpointHash -ne
    $ExpectedBaselineCheckpointHash
) {
    throw @"
Checkpoint aborted.

phase8F6-complete.zip is not the authoritative
Phase 8F.6 baseline.

Expected:
$ExpectedBaselineCheckpointHash

Found:
$BaselineCheckpointHash
"@
}

Write-Host "PASS  authoritative Phase 8F.6 parent"

# ============================================================
# PHASE 8F.7 SOURCE HASH GATE
# ============================================================

$ComposeHash = (
    Get-FileHash `
        -LiteralPath $ComposePath `
        -Algorithm SHA256
).Hash

$EnvExampleHash = (
    Get-FileHash `
        -LiteralPath $EnvExamplePath `
        -Algorithm SHA256
).Hash

$ReadmeHash = (
    Get-FileHash `
        -LiteralPath $ReadmePath `
        -Algorithm SHA256
).Hash

Write-Host ""
Write-Host "Production Compose:"
Write-Host "  $ComposeHash"

Write-Host ""
Write-Host "production.env.example:"
Write-Host "  $EnvExampleHash"

Write-Host ""
Write-Host "README:"
Write-Host "  $ReadmeHash"

if ($ComposeHash -ne $ExpectedComposeHash) {
    throw "docker-compose.prod.yml is not the approved Phase 8F.7 source."
}

if ($EnvExampleHash -ne $ExpectedEnvExampleHash) {
    throw "production.env.example is not the approved Phase 8F.7 source."
}

if ($ReadmeHash -ne $ExpectedReadmeHash) {
    throw "README.md changed unexpectedly after the Phase 8F.6 correction."
}

Write-Host ""
Write-Host "PASS  approved Phase 8F.7 source hashes"

# ============================================================
# VERIFY FINAL VERIFIER IS PARSEABLE
# ============================================================

$Tokens = $null
$ParseErrors = $null

[void][System.Management.Automation.Language.Parser]::ParseFile(
    $VerifierPath,
    [ref]$Tokens,
    [ref]$ParseErrors
)

if ($ParseErrors.Count -ne 0) {

    foreach ($ParseError in $ParseErrors) {

        Write-Host ""
        Write-Host $ParseError.Message
        Write-Host (
            "Line {0}, Column {1}" -f `
            $ParseError.Extent.StartLineNumber,
            $ParseError.Extent.StartColumnNumber
        )
    }

    throw "Phase 8F.7 verifier does not parse cleanly."
}

$VerifierHash = (
    Get-FileHash `
        -LiteralPath $VerifierPath `
        -Algorithm SHA256
).Hash

$ApplyScriptHash = (
    Get-FileHash `
        -LiteralPath $ApplyScriptPath `
        -Algorithm SHA256
).Hash

Write-Host ""
Write-Host "Final Phase 8F.7 verifier SHA-256:"
Write-Host "  $VerifierHash"

Write-Host ""
Write-Host "Phase 8F.7 apply script SHA-256:"
Write-Host "  $ApplyScriptHash"

Write-Host ""
Write-Host "PASS  verifier parse gate"

# ============================================================
# CREATE PERMANENT PHASE 8F.7 COMPLETION RECORD
# ============================================================

$Phase8F7Docs = Join-Path `
    $ProjectRoot `
    "docs\phases\phase8F7"

New-Item `
    -ItemType Directory `
    -Path $Phase8F7Docs `
    -Force |
    Out-Null

$CompletionPath = Join-Path `
    $Phase8F7Docs `
    "PHASE8F7_COMPLETION.md"

$CompletionDocument = @"
# Phase 8F.7 — Production Resource Governance

Status: COMPLETE

Completion date: 2026-10-08

Parent checkpoint:

phase8F6-complete.zip

Parent SHA-256:

$ExpectedBaselineCheckpointHash

## Objective

Prevent a single production Compose service from exhausting the Docker host's
CPU, memory, or process capacity while preserving all accepted Phase 8F.6
runtime-hardening and application behaviour.

## Accepted production resource policy

| Service | CPU | Memory | PID limit |
| --- | ---: | ---: | ---: |
| PostgreSQL | 1.0 | 512 MiB | 128 |
| Migrate | 1.0 | 384 MiB | 64 |
| Backend | 2.0 | 1536 MiB | 128 |
| Frontend | 0.5 | 256 MiB | 64 |

## Acceptance gates

Phase 8F.7 source gate: PASS

Pre-deployment recovery gate: PASS

Engine-level resource inspection: PASS

Database persistence gate: PASS

Inherited Phase 8F.6 hardening regression: PASS

Phase 8F.7 automated acceptance gate: PASS

Authenticated browser regression: PASS

## Approved production configuration

docker-compose.prod.yml SHA-256:

$ComposeHash

production.env.example SHA-256:

$EnvExampleHash

## Canonical Phase 8F.7 verifier

scripts/verify-phase8F7-resource-governance.ps1

SHA-256:

$VerifierHash

## Phase 8F.7 source-application script

scripts/apply-phase8F7-resource-governance.ps1

SHA-256:

$ApplyScriptHash

## Database recovery evidence

Pre-deployment backup:

phase8f7-pre-resource-governance-20261008-011723.dump

Backup size:

15438 bytes

Backup SHA-256:

11141E7E5ADBAE9B509CEA52BE12BB1EE0F45F9F843584457D9FF745FE8B1D4B

The backup is intentionally excluded from this source checkpoint.

Pre-deployment database state:

users|datasets|notebooks|dashboards

1|1|1|1

Post-deployment database state:

1|1|1|1

Alembic revision before and after deployment:

20261006_0004

## Runtime acceptance evidence

PostgreSQL:

- NanoCpus = 1000000000
- Memory = 536870912 bytes
- PidsLimit = 128
- OOMKilled = false
- healthy

Migrate:

- NanoCpus = 1000000000
- Memory = 402653184 bytes
- PidsLimit = 64
- OOMKilled = false
- ExitCode = 0
- appuser

Backend:

- NanoCpus = 2000000000
- Memory = 1610612736 bytes
- PidsLimit = 128
- OOMKilled = false
- healthy

Frontend:

- NanoCpus = 500000000
- Memory = 268435456 bytes
- PidsLimit = 64
- OOMKilled = false
- healthy

Inherited Phase 8F.6 runtime controls remained accepted:

- read-only root filesystems
- writable-path boundaries
- no-new-privileges
- capability restrictions
- non-root application containers
- production network boundaries
- PostgreSQL capability policy
- migration hardening
- readiness/health behaviour

## Browser regression

The existing persisted production state was exercised successfully through:

login
-> Production Sales Smoke Test dataset
-> existing notebook SQL execution
-> Production Sales Dashboard Refresh Data
-> logout
-> protected-route redirect

Expected SQL output remained:

Laptop      3600.49
Monitor      899.97
Keyboard     374.95
Mouse        239.92

## Scope confirmation

Existing functional/configuration files changed by Phase 8F.7:

- docker-compose.prod.yml
- production.env.example

New Phase 8F.7 tooling/documentation:

- scripts/apply-phase8F7-resource-governance.ps1
- scripts/verify-phase8F7-resource-governance.ps1
- scripts/create-phase8F7-full-checkpoint.ps1
- docs/phases/phase8F7/PHASE8F7_COMPLETION.md

No backend application source, frontend application source, database schema,
database data model, Dockerfile, Nginx configuration, authentication logic,
volume topology, or production network topology was intentionally changed.

Caddy remains intentionally outside the Compose-managed resource-governance
scope and is not claimed as hardened by Phase 8F.7.

## Checkpoint exclusions

This checkpoint intentionally excludes:

- production secrets
- local .env files
- machine-local TLS certificates
- database backups
- runtime state
- uploaded runtime data
- node_modules
- frontend dist
- coverage output
- Python caches
- test caches
- reconciliation/archive material
- prior checkpoint ZIPs
- rollback-only Compose configuration
- ad-hoc smoke CSV files
"@

Write-Utf8NoBom `
    -Path $CompletionPath `
    -Text $CompletionDocument

Write-Host ""
Write-Host "PASS  Phase 8F.7 completion record written"

# ============================================================
# CHECKPOINT EXCLUSION POLICY
# ============================================================

$ExcludedDirectoryNames = @(
    ".git",
    "__pycache__",
    "node_modules",
    "dist",
    "coverage",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    ".vite",
    ".vite-temp",
    ".tmp"
)

$ExcludedRootDirectories = @(
    ".phase8f6",
    ".phase8f7",
    "archive",
    "backups",
    "checkpoints"
)

$ExcludedExactFiles = @(
    "docker-compose.prod.pre-8f6.yml",
    "reconcile-project-root-phase8f6.ps1",
    "PROJECT_STRUCTURE.txt",
    "PROJECT_STRUCTURE_AFTER.txt",
    "python_limit_test.csv",
    "sales_test.csv",
    "sales-smoke.csv",
    "frontend\phase8a4-one-failure.txt",
    "frontend\phase8a4-test-failures.txt",
    "frontend\phase8a5-one-failure.txt"
)

function Test-CheckpointExclusion {

    param(
        [Parameter(Mandatory = $true)]
        [string]$RelativePath
    )

    $RelativePath =
        $RelativePath.Replace("/", "\").TrimStart("\")

    $Segments = $RelativePath -split "\\"

    $LeafName =
        $Segments[$Segments.Count - 1]

    # Secrets
    if ($LeafName -ieq ".env") {
        return $true
    }

    if ($LeafName -ieq "production.env") {
        return $true
    }

    if ($LeafName -ieq "caddy-local-root.crt") {
        return $true
    }

    foreach ($ExcludedFile in $ExcludedExactFiles) {

        if ($RelativePath -ieq $ExcludedFile) {
            return $true
        }
    }

    foreach ($Segment in $Segments) {

        foreach ($ExcludedDirectory in $ExcludedDirectoryNames) {

            if ($Segment -ieq $ExcludedDirectory) {
                return $true
            }
        }
    }

    if ($Segments.Count -gt 0) {

        foreach ($ExcludedRootDirectory in $ExcludedRootDirectories) {

            if ($Segments[0] -ieq $ExcludedRootDirectory) {
                return $true
            }
        }
    }

    if (
        $RelativePath -ieq "backend\uploads" -or
        $RelativePath.StartsWith(
            "backend\uploads\",
            [System.StringComparison]::OrdinalIgnoreCase
        )
    ) {
        return $true
    }

    $Extension =
        [System.IO.Path]::GetExtension(
            $LeafName
        )

    if ($Extension -ieq ".pyc") {
        return $true
    }

    if ($Extension -ieq ".pyo") {
        return $true
    }

    if ($Extension -ieq ".log") {
        return $true
    }

    if ($Extension -ieq ".dump") {
        return $true
    }

    if ($Extension -ieq ".crt") {
        return $true
    }

    if ($Extension -ieq ".key") {
        return $true
    }

    if ($Extension -ieq ".pem") {
        return $true
    }

    if ($Extension -ieq ".zip") {
        return $true
    }

    return $false
}

# ============================================================
# PREPARE STAGING
# ============================================================

$Timestamp =
    Get-Date -Format "yyyyMMdd-HHmmss"

$StageRoot = Join-Path `
    $env:TEMP `
    "phase8F7-checkpoint-$Timestamp"

$StageProject = Join-Path `
    $StageRoot `
    "databricks-clone-v1"

if (Test-Path -LiteralPath $StageRoot) {

    Remove-Item `
        -LiteralPath $StageRoot `
        -Recurse `
        -Force
}

New-Item `
    -ItemType Directory `
    -Path $StageProject `
    -Force |
    Out-Null

New-Item `
    -ItemType Directory `
    -Path $CheckpointDir `
    -Force |
    Out-Null

Write-Host ""
Write-Host "============================================================"
Write-Host "PHASE 8F.7 FULL CHECKPOINT FREEZE"
Write-Host "============================================================"
Write-Host ""
Write-Host "Project root:"
Write-Host "  $ProjectRoot"
Write-Host ""
Write-Host "Temporary stage:"
Write-Host "  $StageProject"

$CopiedFiles = 0
$SkippedFiles = 0

Get-ChildItem `
    -LiteralPath $ProjectRoot `
    -Recurse `
    -Force `
    -File |
ForEach-Object {

    $RelativePath =
        Get-RelativePathCompat `
            -BasePath $ProjectRoot `
            -TargetPath $_.FullName

    if (
        Test-CheckpointExclusion `
            -RelativePath $RelativePath
    ) {
        $SkippedFiles++
        return
    }

    $Destination = Join-Path `
        $StageProject `
        $RelativePath

    $DestinationDirectory =
        Split-Path `
            -Parent `
            $Destination

    New-Item `
        -ItemType Directory `
        -Path $DestinationDirectory `
        -Force |
        Out-Null

    Copy-Item `
        -LiteralPath $_.FullName `
        -Destination $Destination `
        -Force

    $CopiedFiles++
}

Write-Host ""
Write-Host "Source files copied:"
Write-Host "  $CopiedFiles"

Write-Host ""
Write-Host "Files excluded:"
Write-Host "  $SkippedFiles"

# ============================================================
# LOAD AUTHORITATIVE 8F.6 MANIFEST
# ============================================================

Add-Type `
    -AssemblyName System.IO.Compression.FileSystem

Add-Type `
    -AssemblyName System.IO.Compression `
    -ErrorAction SilentlyContinue

$BaselineArchive =
    [System.IO.Compression.ZipFile]::OpenRead(
        $BaselineZip
    )

try {

    $BaselineManifestText =
        Get-ZipEntryText `
            -ZipArchive $BaselineArchive `
            -EntryName "databricks-clone-v1/MANIFEST_SHA256.txt"

    $BaselineHashes = @{}

    foreach (
        $Line in (
            $BaselineManifestText -split "`r?`n"
        )
    ) {

        if (
            $Line -match
            '^([A-Fa-f0-9]{64})\s{2}(.+)$'
        ) {

            $BaselineHashes[
                $Matches[2]
            ] = $Matches[1].ToUpperInvariant()
        }
    }

    if ($BaselineHashes.Count -lt 20) {
        throw "Could not parse the authoritative Phase 8F.6 manifest."
    }

    # --------------------------------------------------------
    # Preserve exact Phase 8F.6 completion record
    # --------------------------------------------------------

    $Phase8F6CompletionStage = Join-Path `
        $StageProject `
        "docs\phases\phase8F6\PHASE8F6_COMPLETION.md"

    Extract-ZipEntry `
        -ZipArchive $BaselineArchive `
        -EntryName "databricks-clone-v1/docs/phases/phase8F6/PHASE8F6_COMPLETION.md" `
        -Destination $Phase8F6CompletionStage

    $Phase8F6CompletionHash = (
        Get-FileHash `
            -LiteralPath $Phase8F6CompletionStage `
            -Algorithm SHA256
    ).Hash

    if (
        $Phase8F6CompletionHash -ne
        $ExpectedPhase8F6CompletionHash
    ) {
        throw "Preserved Phase 8F.6 completion record hash is incorrect."
    }

    Write-Host ""
    Write-Host "PASS  preserved exact Phase 8F.6 completion record"

    # --------------------------------------------------------
    # Prove backend/frontend have NO drift from Phase 8F.6
    # --------------------------------------------------------

    Write-Host ""
    Write-Host "Checking backend/frontend lineage against Phase 8F.6..."

    $StageAppFiles = @()

$AllStageFiles = Get-ChildItem `
    -LiteralPath $StageProject `
    -Recurse `
    -Force `
    -File

foreach ($CandidateFile in $AllStageFiles) {

    $CandidateRelativePath = (
        Get-RelativePathCompat `
            -BasePath $StageProject `
            -TargetPath $CandidateFile.FullName
    ).Replace("\", "/")

    if (
        ($CandidateRelativePath -like "backend/*") -or
        ($CandidateRelativePath -like "frontend/*")
    ) {
        $StageAppFiles += $CandidateFile
    }
}

    $StageAppPaths = @{}

    foreach ($File in $StageAppFiles) {

        $Rel = (
            Get-RelativePathCompat `
                -BasePath $StageProject `
                -TargetPath $File.FullName
        ).Replace("\", "/")

        $Hash = (
            Get-FileHash `
                -LiteralPath $File.FullName `
                -Algorithm SHA256
        ).Hash

        if (-not $BaselineHashes.ContainsKey($Rel)) {
            throw "Unexpected backend/frontend file not present in Phase 8F.6: $Rel"
        }

        if ($BaselineHashes[$Rel] -ne $Hash) {
            throw "Backend/frontend drift detected: $Rel"
        }

        $StageAppPaths[$Rel] = $true
    }

    $BaselineAppPaths = @(
        $BaselineHashes.Keys |
        Where-Object {
            $_.StartsWith(
                "backend/",
                [System.StringComparison]::OrdinalIgnoreCase
            ) -or
            $_.StartsWith(
                "frontend/",
                [System.StringComparison]::OrdinalIgnoreCase
            )
        }
    )

    foreach ($BaselineAppPath in $BaselineAppPaths) {

        if (-not $StageAppPaths.ContainsKey($BaselineAppPath)) {
            throw "Backend/frontend file missing relative to Phase 8F.6: $BaselineAppPath"
        }
    }

    Write-Host (
        "PASS  backend/frontend lineage: {0}/{0} files byte-identical" -f `
        $BaselineAppPaths.Count
    )
}
finally {

    $BaselineArchive.Dispose()
}

# ============================================================
# GENERATE CHECKPOINT INVENTORY
# ============================================================

$InventoryPath = Join-Path `
    $StageProject `
    "CHECKPOINT_CONTENTS.txt"

$InventoryLines =
    New-Object `
        System.Collections.Generic.List[string]

$InventoryItems = Get-ChildItem `
    -LiteralPath $StageProject `
    -Recurse `
    -Force |
    Sort-Object FullName

foreach ($Item in $InventoryItems) {

    $RelativePath =
        Get-RelativePathCompat `
            -BasePath $StageProject `
            -TargetPath $Item.FullName

    if ($Item.PSIsContainer) {
        $InventoryLines.Add(
            "[DIR]  $RelativePath"
        )
    }
    else {
        $InventoryLines.Add(
            "[FILE] $RelativePath"
        )
    }
}

Write-Utf8NoBom `
    -Path $InventoryPath `
    -Text (
        ($InventoryLines -join "`r`n") +
        "`r`n"
    )

# ============================================================
# GENERATE SHA-256 MANIFEST
# ============================================================

$ManifestPath = Join-Path `
    $StageProject `
    "MANIFEST_SHA256.txt"

$ManifestLines =
    New-Object `
        System.Collections.Generic.List[string]

$ManifestFiles = Get-ChildItem `
    -LiteralPath $StageProject `
    -Recurse `
    -Force `
    -File |
    Sort-Object FullName

foreach ($File in $ManifestFiles) {

    if ($File.FullName -eq $ManifestPath) {
        continue
    }

    $RelativePath = (
        Get-RelativePathCompat `
            -BasePath $StageProject `
            -TargetPath $File.FullName
    ).Replace("\", "/")

    $Hash = (
        Get-FileHash `
            -LiteralPath $File.FullName `
            -Algorithm SHA256
    ).Hash

    $ManifestLines.Add(
        "$Hash  $RelativePath"
    )
}

Write-Utf8NoBom `
    -Path $ManifestPath `
    -Text (
        ($ManifestLines -join "`r`n") +
        "`r`n"
    )

Write-Host ""
Write-Host "Manifest-controlled files:"
Write-Host "  $($ManifestLines.Count)"

# ============================================================
# PRESERVE ANY OLDER 8F.7 CHECKPOINT
# ============================================================

if (
    (Test-Path -LiteralPath $ZipPath) -or
    (Test-Path -LiteralPath $HashPath)
) {

    $SupersededDirectory = Join-Path `
        $CheckpointDir `
        "superseded\$Timestamp"

    New-Item `
        -ItemType Directory `
        -Path $SupersededDirectory `
        -Force |
        Out-Null

    if (Test-Path -LiteralPath $ZipPath) {

        Move-Item `
            -LiteralPath $ZipPath `
            -Destination $SupersededDirectory `
            -Force
    }

    if (Test-Path -LiteralPath $HashPath) {

        Move-Item `
            -LiteralPath $HashPath `
            -Destination $SupersededDirectory `
            -Force
    }

    Write-Host ""
    Write-Host "Existing Phase 8F.7 checkpoint preserved:"
    Write-Host "  $SupersededDirectory"
}

# ============================================================
# CREATE PORTABLE ZIP
# ============================================================

$ZipFileStream = $null
$PortableZipArchive = $null

try {

    $ZipFileStream = [System.IO.File]::Open(
        $ZipPath,
        [System.IO.FileMode]::CreateNew,
        [System.IO.FileAccess]::ReadWrite,
        [System.IO.FileShare]::None
    )

    $PortableZipArchive = New-Object `
        System.IO.Compression.ZipArchive(
            $ZipFileStream,
            [System.IO.Compression.ZipArchiveMode]::Create,
            $false
        )

    $FilesToZip = Get-ChildItem `
        -LiteralPath $StageProject `
        -Recurse `
        -Force `
        -File |
        Sort-Object FullName

    foreach ($SourceFile in $FilesToZip) {

        $RelativePath =
            Get-RelativePathCompat `
                -BasePath $StageProject `
                -TargetPath $SourceFile.FullName

        $PortableRelativePath =
            $RelativePath.Replace("\", "/")

        $EntryName =
            "databricks-clone-v1/" +
            $PortableRelativePath

        $ZipEntry =
            $PortableZipArchive.CreateEntry(
                $EntryName,
                [System.IO.Compression.CompressionLevel]::Optimal
            )

        $InputStream = $null
        $EntryStream = $null

        try {

            $InputStream =
                [System.IO.File]::OpenRead(
                    $SourceFile.FullName
                )

            $EntryStream =
                $ZipEntry.Open()

            $InputStream.CopyTo(
                $EntryStream
            )
        }
        finally {

            if ($null -ne $EntryStream) {
                $EntryStream.Dispose()
            }

            if ($null -ne $InputStream) {
                $InputStream.Dispose()
            }
        }
    }
}
finally {

    if ($null -ne $PortableZipArchive) {
        $PortableZipArchive.Dispose()
    }

    if ($null -ne $ZipFileStream) {
        $ZipFileStream.Dispose()
    }
}

if (-not (Test-Path -LiteralPath $ZipPath)) {
    throw "Phase 8F.7 checkpoint ZIP was not created."
}

# ============================================================
# ARCHIVE VALIDATION
# ============================================================

Write-Host ""
Write-Host "Validating checkpoint archive..."

$ZipArchive =
    [System.IO.Compression.ZipFile]::OpenRead(
        $ZipPath
    )

try {

    $EntryNames = @(
        $ZipArchive.Entries |
        ForEach-Object {
            $_.FullName
        }
    )

    if ($EntryNames.Count -lt 20) {
        throw "Checkpoint contains unexpectedly few entries."
    }

    foreach ($EntryName in $EntryNames) {

        if ($EntryName.Contains("\")) {
            throw "Non-portable backslash ZIP entry detected: $EntryName"
        }

        if (
            -not $EntryName.StartsWith(
                "databricks-clone-v1/",
                [System.StringComparison]::Ordinal
            )
        ) {
            throw "Unexpected ZIP root: $EntryName"
        }
    }

    $RequiredEntries = @(
        "databricks-clone-v1/backend/Dockerfile.prod",
        "databricks-clone-v1/frontend/Dockerfile.prod",
        "databricks-clone-v1/frontend/nginx.prod.conf",
        "databricks-clone-v1/docker-compose.prod.yml",
        "databricks-clone-v1/production.env.example",
        "databricks-clone-v1/README.md",
        "databricks-clone-v1/scripts/apply-phase8F7-resource-governance.ps1",
        "databricks-clone-v1/scripts/verify-phase8F7-resource-governance.ps1",
        "databricks-clone-v1/scripts/create-phase8F7-full-checkpoint.ps1",
        "databricks-clone-v1/docs/phases/phase8F6/PHASE8F6_COMPLETION.md",
        "databricks-clone-v1/docs/phases/phase8F7/PHASE8F7_COMPLETION.md",
        "databricks-clone-v1/CHECKPOINT_CONTENTS.txt",
        "databricks-clone-v1/MANIFEST_SHA256.txt"
    )

    foreach ($RequiredEntry in $RequiredEntries) {

        if ($EntryNames -notcontains $RequiredEntry) {
            throw "Checkpoint missing required entry: $RequiredEntry"
        }
    }

    $ForbiddenPatterns = @(
        '(^|/)production\.env$',
        '(^|/)\.env$',
        '(^|/)caddy-local-root\.crt$',
        '(^|/)backups(/|$)',
        '(^|/)archive(/|$)',
        '(^|/)checkpoints(/|$)',
        '(^|/)\.phase8f6(/|$)',
        '(^|/)\.phase8f7(/|$)',
        '(^|/)node_modules(/|$)',
        '(^|/)dist(/|$)',
        '(^|/)coverage(/|$)',
        '(^|/)__pycache__(/|$)',
        '(^|/)backend/uploads(/|$)',
        '(^|/)docker-compose\.prod\.pre-8f6\.yml$',
        '(^|/)python_limit_test\.csv$',
        '(^|/)sales_test\.csv$',
        '(^|/)sales-smoke\.csv$',
        '\.dump$',
        '\.pyc$',
        '\.pyo$',
        '\.key$',
        '\.pem$',
        '\.crt$',
        '\.zip$'
    )

    foreach ($EntryName in $EntryNames) {

        foreach ($Pattern in $ForbiddenPatterns) {

            if ($EntryName -match $Pattern) {

                throw @"
Checkpoint contains forbidden content:

$EntryName
"@
            }
        }
    }

    Write-Host "PASS  portable ZIP paths"
    Write-Host "PASS  required checkpoint entries"
    Write-Host "PASS  secret/runtime exclusion policy"
}
finally {

    $ZipArchive.Dispose()
}

# ============================================================
# FINAL ZIP HASH + SIDECAR
# ============================================================

$ZipHash = (
    Get-FileHash `
        -LiteralPath $ZipPath `
        -Algorithm SHA256
).Hash

$Sidecar = @"
PHASE 8F.7 FULL CHECKPOINT

FILE
$CheckpointName.zip

SHA256
$ZipHash

CREATED
$(Get-Date -Format "yyyy-MM-dd HH:mm:ss")

SOURCE
$ProjectRoot

PARENT CHECKPOINT
phase8F6-complete.zip

PARENT SHA256
$BaselineCheckpointHash

SOURCE FILES COPIED
$CopiedFiles

EXCLUDED FILES
$SkippedFiles

MANIFEST-CONTROLLED FILES
$($ManifestLines.Count)

PRODUCTION COMPOSE SHA256
$ComposeHash

PRODUCTION ENV EXAMPLE SHA256
$EnvExampleHash

CANONICAL PHASE 8F.7 VERIFIER SHA256
$VerifierHash

PHASE 8F.7 APPLY SCRIPT SHA256
$ApplyScriptHash
"@

Write-Utf8NoBom `
    -Path $HashPath `
    -Text $Sidecar

# ============================================================
# CLEAN TEMPORARY STAGING
# ============================================================

if (Test-Path -LiteralPath $StageRoot) {

    Remove-Item `
        -LiteralPath $StageRoot `
        -Recurse `
        -Force
}

# ============================================================
# PASS
# ============================================================

Write-Host ""
Write-Host "============================================================"
Write-Host "PHASE 8F.7 FULL CHECKPOINT: PASS"
Write-Host "============================================================"

Write-Host ""
Write-Host "Checkpoint:"
Write-Host "  $ZipPath"

Write-Host ""
Write-Host "SHA-256:"
Write-Host "  $ZipHash"

Write-Host ""
Write-Host "Sidecar:"
Write-Host "  $HashPath"

Write-Host ""
Write-Host "Parent Phase 8F.6:"
Write-Host "  $BaselineCheckpointHash"

Write-Host ""
Write-Host "Production Compose:"
Write-Host "  $ComposeHash"

Write-Host ""
Write-Host "production.env.example:"
Write-Host "  $EnvExampleHash"

Write-Host ""
Write-Host "Canonical Phase 8F.7 verifier:"
Write-Host "  $VerifierHash"

Write-Host ""
Write-Host "Source files copied:"
Write-Host "  $CopiedFiles"

Write-Host ""
Write-Host "Excluded files:"
Write-Host "  $SkippedFiles"

Write-Host ""
Write-Host "Manifest-controlled files:"
Write-Host "  $($ManifestLines.Count)"

Write-Host ""
Write-Host "Phase 8F.7 FUNCTIONAL STATE: COMPLETE"
Write-Host "Final checkpoint re-audit: PENDING"
Write-Host "============================================================"