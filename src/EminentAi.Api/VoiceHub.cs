using Microsoft.AspNetCore.SignalR;
using System.Runtime.CompilerServices;
using System.Threading.Channels;

namespace EminentAi.Api;

public class VoiceHub : Hub
{
    private readonly ILogger<VoiceHub> _logger;

    public VoiceHub(ILogger<VoiceHub> _logger)
    {
        this._logger = _logger;
    }

    /// <summary>
    /// Bi-directional stream for Real-time Voice Mode.
    /// Frontend streams audio chunks (PCM 16k), Backend transcribes, processes with LLM, and streams back TTS.
    /// </summary>
    public async Task StreamVoice(ChannelReader<byte[]> audioStream)
    {
        _logger.LogInformation("Voice stream started for connection {ConnectionId}", Context.ConnectionId);

        // This is where the magic happens:
        // 1. Buffer audioStream -> Whisper
        // 2. Transcribed text -> Ollama
        // 3. LLM tokens -> TTS (Piper)
        // 4. TTS audio -> Clients.Caller.SendAsync("ReceiveAudio", ...)

        while (await audioStream.WaitToReadAsync())
        {
            while (audioStream.TryRead(out var chunk))
            {
                // Process chunk (VAD, STT, etc.)
                // For now, we just acknowledge or log.
                // In a full implementation, this connects to the Whisper server.
            }
        }

        _logger.LogInformation("Voice stream ended for connection {ConnectionId}", Context.ConnectionId);
    }

    /// <summary>
    /// Client sends video frames (Base64 or binary) for vision-capable models.
    /// </summary>
    public async Task SendVideoFrame(byte[] frame)
    {
        // Process video frame with vision model
        await Clients.Caller.SendAsync("VideoProcessed", new { status = "seen" });
    }
}
