# One-time Windows network setup: exposes Ollama + EminentAi to the local LAN
# and issues a trusted local certificate for https://eka.eminent.ai.
#
# Run ONCE as Administrator. Safe to re-run - existing rules/vars are overwritten.
#Requires -RunAsAdministrator

$ErrorActionPreference = "Stop"
$HostIp     = "192.168.1.189"
$Domain     = "eka.eminent.ai"
$VitePort   = 5173
$ApiPort    = 5210
$OllamaPort = 11434

Write-Host "=== EminentAi LAN + HTTPS Network Setup ===" -ForegroundColor Cyan

# ---------------------------------------------------------------------------
# 1. Ollama environment variables
# ---------------------------------------------------------------------------
Write-Host "`n[1/6] Configuring Ollama environment variables..." -ForegroundColor Yellow

[Environment]::SetEnvironmentVariable("OLLAMA_HOST",    "0.0.0.0", "User")
[Environment]::SetEnvironmentVariable("OLLAMA_ORIGINS", "*",       "User")
Write-Host "  OLLAMA_HOST=0.0.0.0  |  OLLAMA_ORIGINS=*"

# ---------------------------------------------------------------------------
# 2. Install mkcert (local CA tool)
# ---------------------------------------------------------------------------
Write-Host "`n[2/6] Checking mkcert..." -ForegroundColor Yellow

if (-not (Get-Command mkcert -ErrorAction SilentlyContinue)) {
    Write-Host "  mkcert not found - installing via winget..."
    winget install --id FiloSottile.mkcert -e --accept-source-agreements --accept-package-agreements
    # Reload PATH so mkcert is immediately available in this session
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH", "User")
}

if (-not (Get-Command mkcert -ErrorAction SilentlyContinue)) {
    Write-Warning "mkcert still not found. Install it manually: https://github.com/FiloSottile/mkcert"
    Write-Warning "Then re-run this script."
    exit 1
}

Write-Host "  Installing mkcert local CA into system trust store..."
mkcert -install

# ---------------------------------------------------------------------------
# 3. Generate certificate for the local domain
# ---------------------------------------------------------------------------
Write-Host "`n[3/6] Generating TLS certificate..." -ForegroundColor Yellow

$certsDir = Join-Path $PSScriptRoot "certs"
if (-not (Test-Path $certsDir)) {
    New-Item -ItemType Directory $certsDir | Out-Null
}

Push-Location $certsDir
mkcert `
    -cert-file "$Domain.pem" `
    -key-file  "$Domain-key.pem" `
    $Domain $HostIp localhost 127.0.0.1
Pop-Location

Write-Host "  Certificate written to: certs\$Domain.pem"

# ---------------------------------------------------------------------------
# 4. Hosts file - map eka.eminent.ai to this machine's LAN IP
# ---------------------------------------------------------------------------
Write-Host "`n[4/6] Updating hosts file..." -ForegroundColor Yellow

$hostsFile  = "C:\Windows\System32\drivers\etc\hosts"
$hostsEntry = "$HostIp $Domain"
$hostsRaw   = Get-Content $hostsFile -Raw

if ($hostsRaw -notmatch [regex]::Escape($hostsEntry)) {
    Add-Content $hostsFile "`n$hostsEntry"
    Write-Host "  Added: $hostsEntry"
} else {
    Write-Host "  Already present: $hostsEntry"
}

# ---------------------------------------------------------------------------
# 5. Port proxy: 443 -> Vite HTTPS port (5173)
#    Kernel-level TCP forwarding - no admin needed to start the app after this.
# ---------------------------------------------------------------------------
Write-Host "`n[5/6] Configuring port proxy 443 -> $VitePort ..." -ForegroundColor Yellow

# Remove stale rule first (ignore error if it does not exist)
netsh interface portproxy delete v4tov4 listenport=443 listenaddress=0.0.0.0 2>$null | Out-Null

netsh interface portproxy add v4tov4 `
    listenport=443         listenaddress=0.0.0.0 `
    connectport=$VitePort  connectaddress=127.0.0.1

Write-Host "  Portproxy: 0.0.0.0:443 -> 127.0.0.1:$VitePort"

# ---------------------------------------------------------------------------
# 6. Firewall rules (Private profile only)
# ---------------------------------------------------------------------------
Write-Host "`n[6/6] Opening firewall ports (Private profile)..." -ForegroundColor Yellow

$rules = @(
    @{ Name = "EminentAi - HTTPS proxy (443)";    Port = 443         },
    @{ Name = "EminentAi - Vite Dev (5173)";       Port = $VitePort   },
    @{ Name = "EminentAi - Backend API (5210)";    Port = $ApiPort    },
    @{ Name = "EminentAi - Ollama (11434)";        Port = $OllamaPort }
)

foreach ($rule in $rules) {
    $existing = Get-NetFirewallRule -DisplayName $rule.Name -ErrorAction SilentlyContinue
    if ($existing) { Remove-NetFirewallRule -DisplayName $rule.Name }
    New-NetFirewallRule `
        -DisplayName $rule.Name `
        -Direction   Inbound `
        -LocalPort   $rule.Port `
        -Protocol    TCP `
        -Action      Allow `
        -Profile     Private | Out-Null
    Write-Host "  Opened TCP $($rule.Port)  ($($rule.Name))"
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
$caRoot = mkcert -CAROOT

Write-Host ""
Write-Host "Setup complete." -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Restart Ollama: right-click tray icon -> Quit, then reopen from Start Menu."
Write-Host "  2. Start the app (no admin needed):"
Write-Host "       .\start.ps1"
Write-Host "  3. On this machine:         https://eka.eminent.ai  or  http://localhost:5173"
Write-Host "  4. On other laptops on LAN:"
Write-Host "       a) Add to their hosts file:  $hostsEntry"
Write-Host "       b) Copy and trust the mkcert CA cert from this machine:"
Write-Host "          $caRoot\rootCA.pem"
Write-Host "       c) Open: https://eka.eminent.ai"
Write-Host ""
Write-Host "NOTE: $HostIp is your current Wi-Fi IP (DHCP). If it changes,"
Write-Host "      update AllowedHosts/AllowedOrigins in src/EminentAi.Api/appsettings.json"
Write-Host "      and re-run this script."
