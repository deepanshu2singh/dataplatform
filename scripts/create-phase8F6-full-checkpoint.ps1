param(
    [string]$ProjectRoot = (Get-Location).Path
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ============================================================
# PHASE 8F.6 FULL CHECKPOINT CREATOR
# Compatible with Windows PowerShell 5.1
# ============================================================

$ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path

$CheckpointDir  = Join-Path $ProjectRoot "checkpoints"
$CheckpointName = "phase8F6-complete"
$ZipPath        = Join-Path $CheckpointDir "$CheckpointName.zip"
$HashPath       = Join-Path $CheckpointDir "$CheckpointName.sha256.txt"

# ------------------------------------------------------------
# Compatibility helper
# Windows PowerShell 5.1 / older .NET does not provide
# [System.IO.Path]::GetRelativePath().
# ------------------------------------------------------------

function Get-RelativePathCompat {
    param(
        [Parameter(Mandatory = $true)]
        [string]$BasePath,

        [Parameter(Mandatory = $true)]
        [string]$TargetPath
    )

    $baseFull = [System.IO.Path]::GetFullPath($BasePath)

    if (-not $baseFull.EndsWith("\")) {
        $baseFull += "\"
    }

    $targetFull = [System.IO.Path]::GetFullPath($TargetPath)

    if (-not $targetFull.StartsWith(
        $baseFull,
        [System.StringComparison]::OrdinalIgnoreCase
    )) {
        throw "Target path is outside project root: $targetFull"
    }

    return $targetFull.Substring($baseFull.Length)
}

# ------------------------------------------------------------
# Safety gate
# ------------------------------------------------------------

$RequiredPaths = @(
    "backend",
    "frontend",
    "scripts",
    "docs\phases\phase8F6",
    "docker-compose.prod.yml",
    "docker-compose.yml",
    "docker-compose.test.yml",
    "production.env.example",
    "Caddyfile.local"
)

Write-Host ""
Write-Host "============================================================"
Write-Host "PHASE 8F.6 FULL CHECKPOINT - PRE-FLIGHT"
Write-Host "============================================================"

foreach ($RelativePath in $RequiredPaths) {

    $FullPath = Join-Path $ProjectRoot $RelativePath

    if (-not (Test-Path -LiteralPath $FullPath)) {
        throw "Checkpoint safety check FAILED. Missing: $RelativePath"
    }

    Write-Host "OK  $RelativePath"
}

# ------------------------------------------------------------
# Verify approved Phase 8F.6 production Compose
# ------------------------------------------------------------

$ExpectedComposeHash =
    "C14B8ED1A47EB8CF830EC7C140E8CBB87D0E7D184D8DECBA574466B11CD6B67B"

$ComposePath = Join-Path $ProjectRoot "docker-compose.prod.yml"

$ActualComposeHash = (
    Get-FileHash `
        -LiteralPath $ComposePath `
        -Algorithm SHA256
).Hash

Write-Host ""
Write-Host "Production Compose SHA-256:"
Write-Host "  $ActualComposeHash"

if ($ActualComposeHash -ne $ExpectedComposeHash) {

    throw @"
Checkpoint aborted.

docker-compose.prod.yml is not the approved Phase 8F.6 version.

Expected:
$ExpectedComposeHash

Actual:
$ActualComposeHash
"@
}

Write-Host "Approved Phase 8F.6 Compose confirmed."

# ------------------------------------------------------------
# Check canonical verifier exists
# ------------------------------------------------------------

$VerifierPath = Join-Path `
    $ProjectRoot `
    "scripts\verify-phase8F6-runtime-hardening.ps1"

if (-not (Test-Path -LiteralPath $VerifierPath)) {
    throw "Canonical Phase 8F.6 verifier is missing."
}

$VerifierHash = (
    Get-FileHash `
        -LiteralPath $VerifierPath `
        -Algorithm SHA256
).Hash

Write-Host ""
Write-Host "Canonical verifier:"
Write-Host "  $VerifierPath"
Write-Host "Verifier SHA-256:"
Write-Host "  $VerifierHash"

# ------------------------------------------------------------
# Prepare staging location
# ------------------------------------------------------------

$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"

$StageRoot = Join-Path `
    $env:TEMP `
    "phase8F6-checkpoint-$Timestamp"

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
Write-Host "PHASE 8F.6 FULL CHECKPOINT FREEZE"
Write-Host "============================================================"
Write-Host "Project root:"
Write-Host "  $ProjectRoot"
Write-Host ""
Write-Host "Temporary staging:"
Write-Host "  $StageProject"

# ------------------------------------------------------------
# Exclusion policy
# ------------------------------------------------------------

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

    $RelativePath = $RelativePath.Replace("/", "\").TrimStart("\")

    $Segments = $RelativePath -split "\\"

    $LeafName = $Segments[$Segments.Count - 1]

    # -------------------------
    # Secrets / machine config
    # -------------------------

    if ($LeafName -ieq ".env") {
        return $true
    }

    if ($LeafName -ieq "production.env") {
        return $true
    }

    if ($LeafName -ieq "caddy-local-root.crt") {
        return $true
    }

    # -------------------------
    # Exact project files
    # -------------------------

    foreach ($ExcludedFile in $ExcludedExactFiles) {

        if ($RelativePath -ieq $ExcludedFile) {
            return $true
        }
    }

    # -------------------------
    # Generated directories
    # anywhere in the path
    # -------------------------

    foreach ($Segment in $Segments) {

        foreach ($ExcludedDirectory in $ExcludedDirectoryNames) {

            if ($Segment -ieq $ExcludedDirectory) {
                return $true
            }
        }
    }

    # -------------------------
    # Root-only directories
    # -------------------------

    if ($Segments.Count -gt 0) {

        foreach ($ExcludedRootDirectory in $ExcludedRootDirectories) {

            if ($Segments[0] -ieq $ExcludedRootDirectory) {
                return $true
            }
        }
    }

    # -------------------------
    # Runtime uploaded files
    # -------------------------

    if (
        $RelativePath -ieq "backend\uploads" -or
        $RelativePath.StartsWith(
            "backend\uploads\",
            [System.StringComparison]::OrdinalIgnoreCase
        )
    ) {
        return $true
    }

    # -------------------------
    # Generated / sensitive
    # extensions
    # -------------------------

    $Extension = [System.IO.Path]::GetExtension($LeafName)

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

    if ($Extension -ieq ".key") {
        return $true
    }

    if ($Extension -ieq ".pem") {
        return $true
    }

    if ($Extension -ieq ".crt") {
        return $true
    }

    if ($Extension -ieq ".zip") {
        return $true
    }

    return $false
}

# ------------------------------------------------------------
# Copy clean source into staging
# ------------------------------------------------------------

$CopiedFiles  = 0
$SkippedFiles = 0

Write-Host ""
Write-Host "Copying clean project source..."

$ProjectFiles = Get-ChildItem `
    -LiteralPath $ProjectRoot `
    -Recurse `
    -Force `
    -File

foreach ($File in $ProjectFiles) {

    $RelativePath = Get-RelativePathCompat `
        -BasePath $ProjectRoot `
        -TargetPath $File.FullName

    if (Test-CheckpointExclusion -RelativePath $RelativePath) {

        $SkippedFiles++
        continue
    }

    $Destination = Join-Path `
        $StageProject `
        $RelativePath

    $DestinationDirectory = Split-Path `
        -Parent `
        $Destination

    if (-not (Test-Path -LiteralPath $DestinationDirectory)) {

        New-Item `
            -ItemType Directory `
            -Path $DestinationDirectory `
            -Force |
            Out-Null
    }

    Copy-Item `
        -LiteralPath $File.FullName `
        -Destination $Destination `
        -Force

    $CopiedFiles++
}

Write-Host ""
Write-Host "Source files copied: $CopiedFiles"
Write-Host "Files excluded:      $SkippedFiles"

# ------------------------------------------------------------
# Create Phase 8F.6 completion record
# ------------------------------------------------------------

$CompletionDate = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

$CompletionDocument = @"
# Phase 8F.6 — Runtime Privilege & Filesystem Hardening

Status: COMPLETE

Completion timestamp: $CompletionDate

## Acceptance gates

Phase 8F.6 source gate: PASS

Phase 8F.6 deployment gate: PASS

Phase 8F.6 automated acceptance gate: PASS

Authenticated browser regression: PASS

## Automated acceptance evidence

HTTPS OpenAPI: 200

PostgreSQL:
accepting connections

Backend readiness:
database = ok
migrations = ok

Frontend health:
ok

Migration service:
fresh hardened runtime probe passed

Alembic:
upgrade head passed

## Browser regression

Existing persisted production state was successfully exercised through:

login
-> existing dataset
-> existing notebook SQL execution
-> existing dashboard Refresh Data
-> logout

## Approved production Compose

SHA-256:

$ActualComposeHash

## Canonical Phase 8F.6 verifier

SHA-256:

$VerifierHash


## Checkpoint artifact correction

The first Phase 8F.6 checkpoint artifact was superseded after post-freeze audit.

Artifact-only corrections:

- restored the application root README from the verified Phase 8F.5 baseline
- restored PHASE8F2_RUNTIME_PID_FIX.md
- restored PHASE8F5_PRODUCTION_VERIFIED.md
- changed ZIP generation to standards-compatible forward-slash entry paths

Superseded checkpoint SHA-256:

EAE4CD9B7F8A655EC940AC2378FABD7C660FF5BF2647362194144B975F5A3822

No backend/frontend application source, production Compose configuration,
database state, production environment, or accepted runtime behavior changed
during this correction.
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
- reconciliation archives
- historical checkpoint ZIPs
- rollback-only Compose configuration
- ad-hoc smoke CSV files
"@

$CompletionDirectory = Join-Path `
    $StageProject `
    "docs\phases\phase8F6"

New-Item `
    -ItemType Directory `
    -Path $CompletionDirectory `
    -Force |
    Out-Null

$CompletionPath = Join-Path `
    $CompletionDirectory `
    "PHASE8F6_COMPLETION.md"

$CompletionDocument |
    Set-Content `
        -LiteralPath $CompletionPath `
        -Encoding UTF8

# ------------------------------------------------------------
# Generate checkpoint contents inventory
# ------------------------------------------------------------

$InventoryPath = Join-Path `
    $StageProject `
    "CHECKPOINT_CONTENTS.txt"

$InventoryLines = New-Object System.Collections.Generic.List[string]

$InventoryItems = Get-ChildItem `
    -LiteralPath $StageProject `
    -Recurse `
    -Force |
    Sort-Object FullName

foreach ($Item in $InventoryItems) {

    $RelativePath = Get-RelativePathCompat `
        -BasePath $StageProject `
        -TargetPath $Item.FullName

    if ($Item.PSIsContainer) {
        $InventoryLines.Add("[DIR]  $RelativePath")
    }
    else {
        $InventoryLines.Add("[FILE] $RelativePath")
    }
}

$InventoryLines |
    Set-Content `
        -LiteralPath $InventoryPath `
        -Encoding UTF8

# ------------------------------------------------------------
# Generate SHA-256 manifest
# ------------------------------------------------------------

$ManifestPath = Join-Path `
    $StageProject `
    "MANIFEST_SHA256.txt"

$ManifestLines = New-Object System.Collections.Generic.List[string]

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

    $RelativePath = Get-RelativePathCompat `
        -BasePath $StageProject `
        -TargetPath $File.FullName

    $RelativePath = $RelativePath.Replace("\", "/")

    $Hash = (
        Get-FileHash `
            -LiteralPath $File.FullName `
            -Algorithm SHA256
    ).Hash

    $ManifestLines.Add(
        "$Hash  $RelativePath"
    )
}

$ManifestLines |
    Set-Content `
        -LiteralPath $ManifestPath `
        -Encoding UTF8

# ------------------------------------------------------------
# Create checkpoint ZIP
# ------------------------------------------------------------

if (Test-Path -LiteralPath $ZipPath) {

    Remove-Item `
        -LiteralPath $ZipPath `
        -Force
}

if (Test-Path -LiteralPath $HashPath) {

    Remove-Item `
        -LiteralPath $HashPath `
        -Force
}

Add-Type `
    -AssemblyName System.IO.Compression.FileSystem

# ------------------------------------------------------------
# Portable ZIP writer
#
# Do not use ZipFile.CreateFromDirectory here.
# Windows/.NET Framework may store "\" in ZIP entry names.
# ZIP entry names are explicitly constructed with "/" instead.
# ------------------------------------------------------------

Add-Type `
    -AssemblyName System.IO.Compression `
    -ErrorAction SilentlyContinue

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

        $RelativePath = Get-RelativePathCompat `
            -BasePath $StageProject `
            -TargetPath $SourceFile.FullName

        $PortableRelativePath = $RelativePath.Replace("\", "/")

        $EntryName =
            "databricks-clone-v1/" + $PortableRelativePath

        $ZipEntry = $PortableZipArchive.CreateEntry(
            $EntryName,
            [System.IO.Compression.CompressionLevel]::Optimal
        )

        $InputStream = $null
        $EntryStream = $null

        try {

            $InputStream = [System.IO.File]::OpenRead(
                $SourceFile.FullName
            )

            $EntryStream = $ZipEntry.Open()

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
    throw "Checkpoint ZIP was not created."
}

# ------------------------------------------------------------
# Validate ZIP contents
# ------------------------------------------------------------

Write-Host ""
Write-Host "Validating checkpoint archive..."

$ZipArchive = [System.IO.Compression.ZipFile]::OpenRead(
    $ZipPath
)

try {

    $EntryNames = @()

    foreach ($Entry in $ZipArchive.Entries) {

        $EntryNames += $Entry.FullName.Replace("\", "/")
    }

    if ($EntryNames.Count -lt 20) {

        throw @"
Checkpoint ZIP sanity check failed.

Archive contains unexpectedly few entries:
$($EntryNames.Count)
"@
    }

    $RequiredEntries = @(
        "databricks-clone-v1/backend/Dockerfile.prod",
        "databricks-clone-v1/frontend/Dockerfile.prod",
        "databricks-clone-v1/frontend/nginx.prod.conf",
        "databricks-clone-v1/docker-compose.prod.yml",
        "databricks-clone-v1/scripts/verify-phase8F6-runtime-hardening.ps1",
        "databricks-clone-v1/docs/phases/phase8F6/PHASE8F6_COMPLETION.md",
        "databricks-clone-v1/CHECKPOINT_CONTENTS.txt",
        "databricks-clone-v1/MANIFEST_SHA256.txt"
    )

    foreach ($RequiredEntry in $RequiredEntries) {

        if ($EntryNames -notcontains $RequiredEntry) {

            throw "Checkpoint missing required entry: $RequiredEntry"
        }
    }

    # Exact/regex validation prevents production.env.example or
    # .env.example from being falsely identified as secrets.

    $ForbiddenPatterns = @(
        '(^|/)production\.env$',
        '(^|/)\.env$',
        '(^|/)caddy-local-root\.crt$',
        '(^|/)backups(/|$)',
        '(^|/)archive(/|$)',
        '(^|/)checkpoints(/|$)',
        '(^|/)\.phase8f6(/|$)',
        '(^|/)node_modules(/|$)',
        '(^|/)dist(/|$)',
        '(^|/)coverage(/|$)',
        '(^|/)__pycache__(/|$)',
        '(^|/)backend/uploads(/|$)',
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
}
finally {

    $ZipArchive.Dispose()
}

# ------------------------------------------------------------
# Calculate final ZIP hash
# ------------------------------------------------------------

$ZipHash = (
    Get-FileHash `
        -LiteralPath $ZipPath `
        -Algorithm SHA256
).Hash

$SidecarContent = @"
PHASE 8F.6 FULL CHECKPOINT

FILE
$CheckpointName.zip

SHA256
$ZipHash

CREATED
$(Get-Date -Format "yyyy-MM-dd HH:mm:ss")

SOURCE
$ProjectRoot

SOURCE FILES COPIED
$CopiedFiles

EXCLUDED FILES
$SkippedFiles

PRODUCTION COMPOSE SHA256
$ActualComposeHash

CANONICAL VERIFIER SHA256
$VerifierHash
"@

$SidecarContent |
    Set-Content `
        -LiteralPath $HashPath `
        -Encoding UTF8

# ------------------------------------------------------------
# Remove temporary staging only after successful validation
# ------------------------------------------------------------

if (Test-Path -LiteralPath $StageRoot) {

    Remove-Item `
        -LiteralPath $StageRoot `
        -Recurse `
        -Force
}

# ------------------------------------------------------------
# PASS
# ------------------------------------------------------------

Write-Host ""
Write-Host "============================================================"
Write-Host "PHASE 8F.6 FULL CHECKPOINT: PASS"
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
Write-Host "Source files copied:"
Write-Host "  $CopiedFiles"

Write-Host ""
Write-Host "Excluded files:"
Write-Host "  $SkippedFiles"

Write-Host ""
Write-Host "Phase 8F.6 is frozen."
Write-Host "============================================================"
