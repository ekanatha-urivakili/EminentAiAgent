$dllPath = Resolve-Path "src/EminentAi.Api/bin/Debug/net10.0/Microsoft.Data.Sqlite.dll"
$coreDllPath = Resolve-Path "src/EminentAi.Api/bin/Debug/net10.0/SQLitePCLRaw.core.dll"
$providerDllPath = Resolve-Path "src/EminentAi.Api/bin/Debug/net10.0/SQLitePCLRaw.provider.e_sqlite3.dll"

[Reflection.Assembly]::LoadFrom($coreDllPath) | Out-Null
[Reflection.Assembly]::LoadFrom($providerDllPath) | Out-Null
[Reflection.Assembly]::LoadFrom($dllPath) | Out-Null

$dbPath = Resolve-Path "src/EminentAi.Api/eminentai.db"
$connStr = "Data Source=$dbPath"
$conn = New-Object Microsoft.Data.Sqlite.SqliteConnection($connStr)

try {
    $conn.Open()
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = "SELECT Email, FullName FROM AdminUsers"
    $reader = $cmd.ExecuteReader()
    $count = 0
    while ($reader.Read()) {
        $count++
        Write-Host "USER: $($reader.GetString(0)) ($($reader.GetString(1)))"
    }
    if ($count -eq 0) {
        Write-Host "NO USERS FOUND"
    }
    $reader.Close()
} catch {
    Write-Host "ERROR: $($_.Exception.Message)"
} finally {
    $conn.Close()
}
