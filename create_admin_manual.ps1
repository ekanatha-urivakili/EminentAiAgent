# This script manually adds an admin user to the EminentAi database.
# Run it on the machine where the backend is running.

param(
    [string]$Email = "admin@eminentai.local",
    [string]$FullName = "Administrator",
    [string]$Password = "Password123!"
)

$dbPath = Resolve-Path "src/EminentAi.Api/eminentai.db"
if (-not (Test-Path $dbPath)) {
    Write-Error "Database not found at $dbPath"
    exit
}

# Helper to hash password exactly like the backend does
function Hash-Password($password) {
    $salt = [System.Security.Cryptography.RandomNumberGenerator]::GetBytes(16)
    $pbkdf2 = New-Object System.Security.Cryptography.Rfc2898DeriveBytes($password, $salt, 100000, [System.Security.Cryptography.HashAlgorithmName]::SHA256)
    $hash = $pbkdf2.GetBytes(32)
    return "$([Convert]::ToBase64String($salt)).$([Convert]::ToBase64String($hash))"
}

$passwordHash = Hash-Password $Password
$id = [Guid]::NewGuid().ToString()
$createdAt = [DateTime]::UtcNow.ToString("O")
$emailLower = $Email.ToLower().Trim()

Write-Host "Adding admin $emailLower..."

# We'll use a temporary C# snippet to use Microsoft.Data.Sqlite if available, 
# or just try to use System.Data.SQLite if it exists, 
# but the safest is to use the DLLs from the bin folder.

$dllPath = Get-ChildItem -Recurse -Filter "Microsoft.Data.Sqlite.dll" | Select-Object -First 1
if ($null -eq $dllPath) {
    Write-Error "Microsoft.Data.Sqlite.dll not found in bin folders. Please build the project first."
    exit
}

Add-Type -Path $dllPath.FullName

$conn = New-Object Microsoft.Data.Sqlite.SqliteConnection("Data Source=$dbPath")
try {
    $conn.Open()
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = "INSERT INTO AdminUsers (Id, FullName, Email, PasswordHash, CreatedAt) VALUES (@id, @name, @email, @hash, @created)"
    $cmd.Parameters.AddWithValue("@id", $id) | Out-Null
    $cmd.Parameters.AddWithValue("@name", $FullName) | Out-Null
    $cmd.Parameters.AddWithValue("@email", $emailLower) | Out-Null
    $cmd.Parameters.AddWithValue("@hash", $passwordHash) | Out-Null
    $cmd.Parameters.AddWithValue("@created", $createdAt) | Out-Null
    
    $cmd.ExecuteNonQuery() | Out-Null
    Write-Host "Successfully added admin user: $Email"
    Write-Host "Password: $Password"
} catch {
    if ($_.Exception.Message -match "UNIQUE constraint failed: AdminUsers.Email") {
        Write-Warning "User $Email already exists. Try updating it instead."
        
        $cmd.CommandText = "UPDATE AdminUsers SET PasswordHash = @hash WHERE Email = @email"
        $cmd.Parameters.Clear()
        $cmd.Parameters.AddWithValue("@hash", $passwordHash) | Out-Null
        $cmd.Parameters.AddWithValue("@email", $emailLower) | Out-Null
        $cmd.ExecuteNonQuery() | Out-Null
        Write-Host "Successfully updated password for existing admin: $Email"
    } else {
        Write-Error "Failed to add admin: $($_.Exception.Message)"
    }
} finally {
    $conn.Close()
}
