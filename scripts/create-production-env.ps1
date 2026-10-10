param(
    [string]$FrontendUrl = "https://app.example.test",
    [int]$AppPort = 8080,
    [switch]$Force
)

$ErrorActionPreference = "Stop"

if (-not $FrontendUrl.StartsWith("https://")) {
    throw "FrontendUrl must start with https:// for production."
}

$outputPath = Join-Path (Get-Location) "production.env"

if ((Test-Path $outputPath) -and -not $Force) {
    throw "production.env already exists. Re-run with -Force only if you intentionally want to replace it."
}

function New-RandomHex([int]$ByteCount) {
    $bytes = New-Object byte[] $ByteCount
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($bytes)
    }
    finally {
        $rng.Dispose()
    }

    return -join ($bytes | ForEach-Object { $_.ToString("x2") })
}

# Hex is intentionally used because it is high entropy and safe inside the
# PostgreSQL connection URL assembled by docker-compose.prod.yml.
$postgresPassword = New-RandomHex 32
$secretKey = New-RandomHex 48

$content = @"
FRONTEND_URL=$FrontendUrl
POSTGRES_PASSWORD=$postgresPassword
SECRET_KEY=$secretKey
APP_BIND_ADDRESS=127.0.0.1
APP_PORT=$AppPort
ACCESS_TOKEN_EXPIRE_MINUTES=1440
AUTH_COOKIE_SAMESITE=lax
LOG_LEVEL=INFO
"@

Set-Content -Path $outputPath -Value $content -Encoding ASCII

Write-Host "Created production.env"
Write-Host "Secrets were generated locally and were not printed."
Write-Host "Frontend origin: $FrontendUrl"
Write-Host "Local application port: $AppPort"
