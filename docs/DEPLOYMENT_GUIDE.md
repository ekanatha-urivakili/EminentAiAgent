# Setup Instructions for Hybrid Deployment

Follow these steps to deploy the frontend to Railway and connect it to your local laptop.

## 1. Local Laptop: Cloudflare Tunnel Setup

You need a secure "bridge" to your local machine. We recommend **Cloudflare Tunnel** (`cloudflared`).

1.  **Install cloudflared:**
    ```bash
    brew install cloudflared  # macOS
    ```
2.  **Authenticate:**
    ```bash
    cloudflared tunnel login
    ```
3.  **Create a Tunnel:**
    ```bash
    cloudflared tunnel create eminentai-bridge
    ```
4.  **Route Traffic:**
    Replace `your-domain.com` with a domain you own on Cloudflare.
    ```bash
    cloudflared tunnel route dns eminentai-bridge api.your-domain.com
    ```
5.  **Run the Tunnel:**
    Point it to your .NET API port (default 5210).
    ```bash
    cloudflared tunnel run --url http://localhost:5210 eminentai-bridge
    ```

## 2. Railway: Frontend Deployment

1.  **Create a New Project** on Railway and link it to your GitHub repository.
2.  **Point to the `web/` directory:** In Railway settings, set the **Root Directory** to `web/`.
3.  **Set Environment Variables:**
    - `VITE_API_URL`: `https://api.your-domain.com`
    - `VITE_WS_URL`: `wss://api.your-domain.com/voice-hub`
4.  **Deploy:** Railway will automatically detect the `Dockerfile` in the `web/` folder and build the site.

## 3. Real-time Voice/Video Mode

The backend is now ready for "ChatGPT-like" interactions.
- **SignalR:** The app now uses `Microsoft.AspNetCore.SignalR` for low-latency binary streaming.
- **Voice Mode:** Captures audio on the frontend, streams chunks to `VoiceHub.cs`, and receives processed audio back.
- **Video Mode:** Can send video frames to the backend for vision-model analysis.

## 4. Security Note
- Your local backend is protected by the `EMINENTAI_API_TOKEN` and the updated CORS policy.
- Ensure the `api.your-domain.com` is only accessible by your Railway instance if you want maximum security (e.g., using Cloudflare Access or checking a secret header).
