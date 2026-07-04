# Exposing Ollama to the Local Network (Windows)

This guide outlines the steps to securely and effectively expose your local Ollama instance (currently running on `localhost:11434`) to other devices on your local network (e.g., your other laptops).

## Objective
Make the local Ollama API accessible via the host machine's local IP address (e.g., `http://192.168.1.189:11434`) across the local network.

## Key Configuration Requirements
1. **Network Binding:** By default, Ollama binds to `127.0.0.1`. We need to bind it to `0.0.0.0` to listen on all network interfaces.
2. **CORS (Cross-Origin Resource Sharing):** If you plan to access Ollama from web applications running on other laptops, we need to configure `OLLAMA_ORIGINS` to accept those requests.
3. **Firewall:** Windows Defender Firewall blocks inbound connections by default. We need to open TCP port `11434`.

---

## Implementation Steps

### Phase 1: Identify Your Local IP Address
Your current active local IP address on the network is **`192.168.1.189`** (Wi-Fi adapter). You will use this IP on the other laptops to connect to Ollama.

### Phase 2: Configure System Environment Variables
Ollama on Windows relies on environment variables for configuration. We need to set these at the system/user level so they persist across restarts.

Open a PowerShell terminal **as Administrator** and run the following commands:

1. **Set `OLLAMA_HOST`:**
   ```powershell
   [Environment]::SetEnvironmentVariable("OLLAMA_HOST", "0.0.0.0", "User")
   ```
2. **Set `OLLAMA_ORIGINS` (Optional but recommended for web clients):**
   ```powershell
   [Environment]::SetEnvironmentVariable("OLLAMA_ORIGINS", "*", "User")
   ```
   *(Note: Using `*` is convenient for a private home network. For stricter security, you can specify comma-separated origins like `"http://192.168.1.*"`).*

### Phase 3: Configure Windows Firewall
We need to allow inbound traffic to port 11434. In the same **Administrator** PowerShell, run:

```powershell
New-NetFirewallRule -DisplayName "Ollama API (Inbound)" -Direction Inbound -LocalPort 11434 -Protocol TCP -Action Allow -Profile Private
```
*(This limits the rule to 'Private' networks, which is safer. Ensure your network connection profile is set to Private in Windows Settings).*

### Phase 4: Restart Ollama
Ollama needs to be fully restarted to pick up the new environment variables.
1. Locate the Ollama icon in your Windows System Tray (bottom right corner).
2. Right-click the icon and select **Quit Ollama**.
3. Re-open Ollama from your Start Menu.

### Phase 5: Verification
1. **From the Host Machine:**
   Open your browser and navigate to: `http://localhost:11434/api/tags`
   *(It should return JSON data of your models).*
2. **From Another Laptop on the Network:**
   Open a browser or terminal and navigate/curl to: `http://192.168.1.189:11434/api/tags`
   *(If successful, you will see the same JSON data).*

---

## Optional: Exposing EminentAi Backend & UI
If your goal is to access the **entire EminentAi Copilot application** (not just the raw Ollama API) from another laptop, you will also need to update its configuration:

1. **Update `appsettings.json` (src/EminentAi.Api):**
   * Change `"AllowedOrigins"` to include `"http://192.168.1.189:5173"`.
2. **Start the API binding to `0.0.0.0`:**
   * Modify `start.ps1` or run manually: `dotnet run --project src/EminentAi.Api --urls "http://0.0.0.0:5210"`
3. **Start the Vite UI binding to network:**
   * In the `web` folder, run: `npm run dev -- --host`
4. **Firewall:**
   * You will need to open ports `5210` (API) and `5173` (Vite) similarly to Phase 3.
