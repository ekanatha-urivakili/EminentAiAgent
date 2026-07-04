# Run this script once as Administrator to open the ports EminentAi needs on the LAN.
# Right-click this file → "Run with PowerShell" → approve the UAC prompt.

$rules = @(
    @{ Name = "EminentAi Backend";  Port = 5210; Desc = "ASP.NET Core API" },
    @{ Name = "EminentAi Frontend"; Port = 5173; Desc = "Vite dev server"  }
)

foreach ($rule in $rules) {
    $existing = Get-NetFirewallRule -DisplayName $rule.Name -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "  [SKIP] '$($rule.Name)' rule already exists." -ForegroundColor DarkGray
    } else {
        New-NetFirewallRule `
            -DisplayName $rule.Name `
            -Description  $rule.Desc `
            -Direction    Inbound `
            -Protocol     TCP `
            -LocalPort    $rule.Port `
            -Action       Allow `
            -Profile      Private | Out-Null
        Write-Host "  [OK]   Opened port $($rule.Port) for '$($rule.Name)'." -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "Done. Other laptops on the same Wi-Fi can now open:" -ForegroundColor Cyan
Write-Host "  http://192.168.1.189:5173" -ForegroundColor Yellow
Write-Host ""
Read-Host "Press Enter to close"
