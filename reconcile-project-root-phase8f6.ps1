param(
    [string]$ProjectRoot = (Get-Location).Path,
    [switch]$Apply
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host $Message
}

$ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path

$requiredPaths = @(
    (Join-Path $ProjectRoot "backend"),
    (Join-Path $ProjectRoot "frontend"),
    (Join-Path $ProjectRoot "scripts"),
    (Join-Path $ProjectRoot "docker-compose.prod.yml")
)

foreach ($required in $requiredPaths) {
    if (-not (Test-Path -LiteralPath $required)) {
        throw "Safety check failed. Expected project item not found: $required"
    }
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$runArchive = Join-Path $ProjectRoot "archive\phase8F6-reconciliation\$stamp"
$historicalCheckpoints = Join-Path $ProjectRoot "checkpoints\historical"
$phaseDocsCurrent = Join-Path $ProjectRoot "docs\phases\phase8F6"
$phaseDocsHistorical = Join-Path $ProjectRoot "docs\phases\historical"
$phaseEvidence = Join-Path $ProjectRoot "docs\phases\evidence"
$scriptBackupDir = Join-Path $runArchive "scripts-before-reconciliation"
$duplicateDocsDir = Join-Path $runArchive "root-duplicates"
$legacyScriptsDir = Join-Path $runArchive "legacy-scripts"
$packageArchiveDir = Join-Path $runArchive "package"
$logPath = Join-Path $runArchive "reconciliation.log"

$plan = New-Object System.Collections.Generic.List[string]

function Add-Plan {
    param([string]$Line)
    $script:plan.Add($Line)
    Write-Host $Line
}

function Ensure-Directory {
    param([string]$Path)
    if ($Apply) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

function Get-UniqueDestination {
    param(
        [string]$DestinationPath
    )

    if (-not (Test-Path -LiteralPath $DestinationPath)) {
        return $DestinationPath
    }

    $dir = Split-Path -Parent $DestinationPath
    $name = [System.IO.Path]::GetFileNameWithoutExtension($DestinationPath)
    $ext = [System.IO.Path]::GetExtension($DestinationPath)
    return (Join-Path $dir ("{0}.dup-{1}{2}" -f $name, $stamp, $ext))
}

function Move-Safely {
    param(
        [string]$Source,
        [string]$Destination
    )

    if (-not (Test-Path -LiteralPath $Source)) {
        Add-Plan "SKIP   missing: $Source"
        return
    }

    $finalDestination = Get-UniqueDestination -DestinationPath $Destination
    Add-Plan "MOVE   $Source -> $finalDestination"

    if ($Apply) {
        $parent = Split-Path -Parent $finalDestination
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
        Move-Item -LiteralPath $Source -Destination $finalDestination
    }
}

function Copy-Canonical {
    param(
        [string]$Source,
        [string]$Destination,
        [string]$BackupDirectory
    )

    if (-not (Test-Path -LiteralPath $Source)) {
        throw "Canonical source missing: $Source"
    }

    if (Test-Path -LiteralPath $Destination) {
        $backupDestination = Join-Path $BackupDirectory (Split-Path -Leaf $Destination)
        Move-Safely -Source $Destination -Destination $backupDestination
    }

    Add-Plan "COPY   $Source -> $Destination"

    if ($Apply) {
        New-Item -ItemType Directory -Path (Split-Path -Parent $Destination) -Force | Out-Null
        Copy-Item -LiteralPath $Source -Destination $Destination -Force
    }
}

Write-Host ""
Write-Host "============================================================"
Write-Host "PROJECT ROOT RECONCILIATION - PHASE 8F.6"
Write-Host "============================================================"
Write-Host "Project root : $ProjectRoot"
Write-Host "Mode         : $(if ($Apply) { 'APPLY' } else { 'PREVIEW ONLY' })"
Write-Host ""
Write-Host "Safety policy:"
Write-Host "  - No application source files are deleted."
Write-Host "  - No database backup is deleted or moved."
Write-Host "  - No .env / production.env file is touched."
Write-Host "  - No Docker Compose production/rollback file is touched."
Write-Host "  - .phase8f6 runtime state is preserved."
Write-Host "  - backend/uploads is preserved."
Write-Host "  - frontend/node_modules, dist and coverage are left untouched."
Write-Host "  - Historical material is MOVED, not deleted."
Write-Host ""

$phasePackage = Join-Path $ProjectRoot "phase8F6-runtime-hardening-audited"
$phasePackageScripts = Join-Path $phasePackage "scripts"
$canonicalScriptsDir = Join-Path $ProjectRoot "scripts"

if (-not (Test-Path -LiteralPath $phasePackage)) {
    throw "Expected Phase 8F.6 package directory is missing: $phasePackage"
}

$verifierSource = Join-Path $phasePackageScripts "verify-phase8F6-runtime-hardening-v2.ps1"
if (-not (Test-Path -LiteralPath $verifierSource)) {
    $verifierSource = Join-Path $phasePackageScripts "verify-phase8F6-runtime-hardening.ps1"
}
if (-not (Test-Path -LiteralPath $verifierSource)) {
    throw "No Phase 8F.6 verifier was found inside the audited package."
}

Write-Host "Canonical Phase 8F.6 verifier source selected:"
Write-Host "  $verifierSource"
Write-Host ""

# ------------------------------------------------------------------
# 1. Establish one canonical Phase 8F.6 script location: .\scripts
# ------------------------------------------------------------------
$scriptMap = @(
    @{ Source = "apply-phase8F6-runtime-hardening.ps1";   Destination = "apply-phase8F6-runtime-hardening.ps1" },
    @{ Source = "cleanup-phase8F6-exploratory.ps1";      Destination = "cleanup-phase8F6-exploratory.ps1" },
    @{ Source = "deploy-phase8F6-runtime-hardening.ps1"; Destination = "deploy-phase8F6-runtime-hardening.ps1" },
    @{ Source = "resume-phase8F6-runtime-hardening.ps1"; Destination = "resume-phase8F6-runtime-hardening.ps1" },
    @{ Source = "rollback-phase8F6-runtime-hardening.ps1"; Destination = "rollback-phase8F6-runtime-hardening.ps1" }
)

foreach ($item in $scriptMap) {
    $src = Join-Path $phasePackageScripts $item.Source
    $dst = Join-Path $canonicalScriptsDir $item.Destination
    Copy-Canonical -Source $src -Destination $dst -BackupDirectory $scriptBackupDir
}

Copy-Canonical `
    -Source $verifierSource `
    -Destination (Join-Path $canonicalScriptsDir "verify-phase8F6-runtime-hardening.ps1") `
    -BackupDirectory $scriptBackupDir

# ------------------------------------------------------------------
# 2. Put Phase 8F.6 documentation in docs\phases\phase8F6
# ------------------------------------------------------------------
$currentDocs = @(
    "README.md",
    "LINEAGE_AUDIT.md",
    "PHASE8F6_RUNTIME_HARDENING.md",
    "BROWSER_ACCEPTANCE.md"
)

foreach ($doc in $currentDocs) {
    $src = Join-Path $phasePackage $doc
    if (Test-Path -LiteralPath $src) {
        $dst = Join-Path $phaseDocsCurrent $doc
        if (Test-Path -LiteralPath $dst) {
            Move-Safely -Source $dst -Destination (Join-Path $duplicateDocsDir ("docs-phase8F6-" + $doc))
        }
        Add-Plan "COPY   $src -> $dst"
        if ($Apply) {
            New-Item -ItemType Directory -Path $phaseDocsCurrent -Force | Out-Null
            Copy-Item -LiteralPath $src -Destination $dst -Force
        }
    }
}

$packageManifest = Join-Path $phasePackage "MANIFEST_SHA256.txt"
if (Test-Path -LiteralPath $packageManifest) {
    $manifestDst = Join-Path $phaseDocsCurrent "PACKAGE_MANIFEST_ORIGINAL.txt"
    Add-Plan "COPY   $packageManifest -> $manifestDst"
    if ($Apply) {
        New-Item -ItemType Directory -Path $phaseDocsCurrent -Force | Out-Null
        Copy-Item -LiteralPath $packageManifest -Destination $manifestDst -Force
    }
}

# ------------------------------------------------------------------
# 3. Move historical checkpoint ZIPs out of project root
# ------------------------------------------------------------------
$rootZips = Get-ChildItem -LiteralPath $ProjectRoot -File -Filter "*.zip" |
    Where-Object {
        $_.Name -match '^(?i:phase.*\.zip)$' -or
        $_.Name -match '^(?i:databricks-clone-v1-phase.*\.zip)$'
    }

foreach ($zip in $rootZips) {
    Move-Safely -Source $zip.FullName -Destination (Join-Path $historicalCheckpoints $zip.Name)
}

# ------------------------------------------------------------------
# 4. Move known historical phase documentation/evidence
# ------------------------------------------------------------------
$historicalDocs = @(
    "PHASE5_NOTEBOOK_HARDENING.md",
    "PHASE6AB_BROWSER_PYTHON_FOUNDATION.md",
    "PHASE8F1_DEPLOYMENT_AUDIT.md",
    "PHASE8F2_PRODUCTION_FRONTEND.md",
    "PHASE8F3_PRODUCTION_BACKEND.md",
    "PHASE8F3_SOURCE_NOTES.md",
    "PHASE8F4_PRODUCTION_COMPOSE.md"
)

foreach ($name in $historicalDocs) {
    Move-Safely `
        -Source (Join-Path $ProjectRoot $name) `
        -Destination (Join-Path $phaseDocsHistorical $name)
}

$evidenceFiles = @(
    "phase8C2-live-schema.sql",
    "phase8C3-constraints.txt",
    "phase8C3-indexes.txt",
    "phase8C3-live-schema.sql"
)

foreach ($name in $evidenceFiles) {
    Move-Safely `
        -Source (Join-Path $ProjectRoot $name) `
        -Destination (Join-Path $phaseEvidence $name)
}

# ------------------------------------------------------------------
# 5. Archive root-level Phase 8F.6 duplicate/drop-in documents
# ------------------------------------------------------------------
$rootDuplicates = @(
    "BROWSER_ACCEPTANCE.md",
    "LINEAGE_AUDIT.md",
    "MANIFEST_SHA256.txt",
    "PHASE8F6_RUNTIME_HARDENING.md",
    "PHASE8F6_DROP_IN_README.txt"
)

foreach ($name in $rootDuplicates) {
    Move-Safely `
        -Source (Join-Path $ProjectRoot $name) `
        -Destination (Join-Path $duplicateDocsDir $name)
}

# Legacy one-off script is not part of the canonical scripts directory.
Move-Safely `
    -Source (Join-Path $ProjectRoot "apply-phase8E5-unused-vi-fix.ps1") `
    -Destination (Join-Path $legacyScriptsDir "apply-phase8E5-unused-vi-fix.ps1")

# Preserve the before-reconciliation inventory if it exists.
Move-Safely `
    -Source (Join-Path $ProjectRoot "PROJECT_STRUCTURE.txt") `
    -Destination (Join-Path $runArchive "PROJECT_STRUCTURE_BEFORE.txt")

# ------------------------------------------------------------------
# 6. Archive the temporary Phase 8F.6 package after extracting canonical items
# ------------------------------------------------------------------
Move-Safely `
    -Source $phasePackage `
    -Destination (Join-Path $packageArchiveDir "phase8F6-runtime-hardening-audited")

if (-not $Apply) {
    Write-Host ""
    Write-Host "============================================================"
    Write-Host "PREVIEW COMPLETE - NO FILES WERE CHANGED"
    Write-Host "============================================================"
    Write-Host ""
    Write-Host "Run the same script with -Apply to perform this reconciliation."
    exit 0
}

# ------------------------------------------------------------------
# 7. Record canonical script hashes after reconciliation
# ------------------------------------------------------------------
Ensure-Directory -Path $runArchive
$hashFile = Join-Path $runArchive "PHASE8F6_CANONICAL_SCRIPT_HASHES.txt"

$phase8f6CanonicalNames = @(
    "apply-phase8F6-runtime-hardening.ps1",
    "cleanup-phase8F6-exploratory.ps1",
    "deploy-phase8F6-runtime-hardening.ps1",
    "resume-phase8F6-runtime-hardening.ps1",
    "rollback-phase8F6-runtime-hardening.ps1",
    "verify-phase8F6-runtime-hardening.ps1"
)

$hashLines = foreach ($name in $phase8f6CanonicalNames) {
    $path = Join-Path $canonicalScriptsDir $name
    if (Test-Path -LiteralPath $path) {
        $h = Get-FileHash -LiteralPath $path -Algorithm SHA256
        "{0}  {1}" -f $h.Hash, $name
    }
}
$hashLines | Set-Content -LiteralPath $hashFile -Encoding UTF8

# ------------------------------------------------------------------
# 8. Generate an AFTER inventory for review
# ------------------------------------------------------------------
function Get-ProjectTree {
    param(
        [string]$Path,
        [string]$Indent = ""
    )

    $items = Get-ChildItem -LiteralPath $Path -Force |
        Sort-Object @{Expression = {$_.PSIsContainer}; Descending = $true}, Name

    foreach ($item in $items) {
        if ($item.PSIsContainer) {
            "$Indent[DIR]  $($item.Name)"
            Get-ProjectTree -Path $item.FullName -Indent "$Indent    "
        }
        else {
            "$Indent[FILE] $($item.Name)"
        }
    }
}

$afterInventory = Join-Path $runArchive "PROJECT_STRUCTURE_AFTER.txt"
$tree = Get-ProjectTree -Path $ProjectRoot
@(
    "PROJECT ROOT:",
    $ProjectRoot,
    "",
    "GENERATED:",
    (Get-Date -Format "yyyy-MM-dd HH:mm:ss"),
    "",
    "============================================================",
    "PROJECT STRUCTURE AFTER PHASE 8F.6 RECONCILIATION",
    "============================================================",
    ""
) + $tree | Set-Content -LiteralPath $afterInventory -Encoding UTF8

$plan | Set-Content -LiteralPath $logPath -Encoding UTF8

Write-Host ""
Write-Host "============================================================"
Write-Host "RECONCILIATION COMPLETE"
Write-Host "============================================================"
Write-Host "No application source or production data was deleted."
Write-Host ""
Write-Host "Canonical Phase 8F.6 scripts:"
Write-Host "  $canonicalScriptsDir"
Write-Host ""
Write-Host "Historical checkpoints:"
Write-Host "  $historicalCheckpoints"
Write-Host ""
Write-Host "Phase documentation:"
Write-Host "  $(Join-Path $ProjectRoot 'docs\phases')"
Write-Host ""
Write-Host "Archived duplicates / previous script versions:"
Write-Host "  $runArchive"
Write-Host ""
Write-Host "Review inventory:"
Write-Host "  $afterInventory"
Write-Host ""
Write-Host "Canonical script hashes:"
Write-Host "  $hashFile"
Write-Host "============================================================"
