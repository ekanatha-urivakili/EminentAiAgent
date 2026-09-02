using System.Diagnostics;
using System.Text.RegularExpressions;
using EminentAi.Application.Abstractions;

namespace EminentAi.Application.Agents.ImageGeneration;

/// <summary>
/// Shared low-level Flux/Ollama image generation, used by both the smart-chat
/// ImageGenerationAgent and the Agent-mode "image.generate" builtin tool.
/// </summary>
public static class FluxImageGenerator
{
    public const string PrimaryModel = "x/flux2-klein:latest";
    public const string FallbackModel = "x/z-image-turbo";

    /// <summary>Generates via <paramref name="primaryModel"/>, falling back to <paramref name="fallbackModel"/> on failure.</summary>
    /// <param name="ollama">
    /// When supplied together with <paramref name="useHttpGenerate"/>, each model attempt tries
    /// `/api/generate` first (§15 item 2) before falling back to the `ollama run` CLI subprocess.
    /// Omitting it preserves the original CLI-only behavior unchanged.
    /// </param>
    public static async Task<(string Base64Png, string ModelUsed)> GenerateWithFallbackAsync(
        string primaryModel, string fallbackModel, string prompt, CancellationToken ct,
        IOllamaClient? ollama = null, bool useHttpGenerate = false)
    {
        try
        {
            return (await GenerateAsync(primaryModel, prompt, ct, ollama, useHttpGenerate), primaryModel);
        }
        catch (Exception primaryEx)
        {
            try
            {
                return (await GenerateAsync(fallbackModel, prompt, ct, ollama, useHttpGenerate), fallbackModel);
            }
            catch (Exception fallbackEx)
            {
                throw new InvalidOperationException(
                    $"Both '{primaryModel}' and '{fallbackModel}' failed. " +
                    $"Primary: {primaryEx.Message}. Fallback: {fallbackEx.Message}");
            }
        }
    }

    /// <summary>
    /// §15 item 2: tries `/api/generate` first when <paramref name="useHttpGenerate"/> and
    /// <paramref name="ollama"/> are both supplied, falling back to the proven `ollama run` CLI
    /// subprocess on ANY failure — including an unrecognized response shape. This exact migration
    /// was attempted once before and reverted because the HTTP response shape for image-output
    /// models couldn't be verified without a live instance; keeping the CLI path as an automatic
    /// fallback means a shape mismatch degrades gracefully instead of breaking generation. Verify
    /// the HTTP path actually returns real images on your own installed models before relying on it
    /// — enable <c>EminentAi:ModelMatrix:UseHttpGenerateForImages</c> and check logs/output.
    /// </summary>
    public static async Task<string> GenerateAsync(
        string model, string prompt, CancellationToken ct,
        IOllamaClient? ollama = null, bool useHttpGenerate = false)
    {
        if (useHttpGenerate && ollama is not null)
        {
            try
            {
                return await ollama.GenerateImageAsync(model, prompt, ct);
            }
            catch (Exception) when (!ct.IsCancellationRequested)
            {
                // Unrecognized/unavailable HTTP response shape — fall through to the CLI path.
            }
        }

        return await GenerateViaCliAsync(model, prompt, ct);
    }

    public static async Task<string> GenerateViaCliAsync(
        string model, string prompt, CancellationToken ct)
    {
        var ollamaBin = ResolveOllamaBinary();
        var workDir = Path.Combine(Path.GetTempPath(), $"eminentai_flux_{Guid.NewGuid():N}");
        Directory.CreateDirectory(workDir);

        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = ollamaBin,
                WorkingDirectory = workDir,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            psi.ArgumentList.Add("run");
            psi.ArgumentList.Add(model);
            psi.ArgumentList.Add(prompt);

            using var process = new Process { StartInfo = psi };
            var stdout = new System.Text.StringBuilder();
            var stderr = new System.Text.StringBuilder();

            process.OutputDataReceived += (_, e) => { if (e.Data != null) stdout.AppendLine(e.Data); };
            process.ErrorDataReceived += (_, e) => { if (e.Data != null) stderr.AppendLine(e.Data); };

            process.Start();
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();

            using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeoutCts.CancelAfter(TimeSpan.FromMinutes(15));
            try
            {
                await process.WaitForExitAsync(timeoutCts.Token);
            }
            catch (OperationCanceledException)
            {
                // §18.2 item 2 / §18.7 Phase 4: WaitForExitAsync being cancelled does NOT stop the
                // underlying OS process — without this, a client disconnect or the 15-minute timeout
                // left `ollama run` running in the background indefinitely, still holding VRAM.
                // entireProcessTree also catches any child process `ollama run` itself spawns.
                TryKillProcessTree(process);
                throw;
            }

            if (process.ExitCode != 0)
                throw new InvalidOperationException(
                    $"ollama run exited with code {process.ExitCode}. " +
                    Truncate(stderr.ToString().Trim(), 300));

            // Strategy A: PNG written to working directory
            var pngFiles = Directory.GetFiles(workDir, "*.png");
            if (pngFiles.Length > 0)
            {
                var bytes = await File.ReadAllBytesAsync(pngFiles[0], ct);
                if (IsPng(bytes)) return Convert.ToBase64String(bytes);
            }

            // Strategy B: stdout contains base64-encoded image
            var b64 = ExtractBase64FromOutput(stdout.ToString());
            if (b64 is not null) return b64;

            throw new InvalidOperationException(
                "ollama run produced no recognisable image output. " +
                $"stdout snippet: '{Truncate(stdout.ToString(), 100)}'");
        }
        finally
        {
            try { Directory.Delete(workDir, recursive: true); } catch { /* best-effort */ }
        }
    }

    private static void TryKillProcessTree(Process process)
    {
        try
        {
            if (!process.HasExited)
                process.Kill(entireProcessTree: true);
        }
        catch
        {
            // Best-effort: the process may have exited between the check and the kill, or the OS
            // may deny the signal — either way there is nothing further we can safely do here.
        }
    }

    public static bool IsPng(byte[] b) =>
        b.Length > 8
        && b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47
        && b[4] == 0x0D && b[5] == 0x0A && b[6] == 0x1A && b[7] == 0x0A;

    public static bool IsJpeg(byte[] b) => b.Length > 2 && b[0] == 0xFF && b[1] == 0xD8;

    public static bool IsWebP(byte[] b) =>
        b.Length > 4
        && b[0] == 0x52 && b[1] == 0x49 && b[2] == 0x46 && b[3] == 0x46;

    public static string? DetectImageFormat(byte[] b)
    {
        if (IsPng(b)) return "png";
        if (IsJpeg(b)) return "jpg";
        if (b.Length > 3 && b[0] == 0x47 && b[1] == 0x49 && b[2] == 0x46) return "gif";
        if (IsWebP(b)) return "webp";
        return null;
    }

    private static string? ExtractBase64FromOutput(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var stripped = Regex.Replace(raw, @"\x1B\[[0-9;]*[mK]", ""); // strip ANSI
        foreach (Match m in Regex.Matches(stripped, @"[A-Za-z0-9+/]{40,}={0,2}")
                                 .OrderByDescending(x => x.Length))
        {
            var candidate = m.Value;
            var padded = candidate.Length % 4 == 0
                ? candidate
                : candidate + new string('=', 4 - candidate.Length % 4);
            try
            {
                var bytes = Convert.FromBase64String(padded);
                if (IsPng(bytes) || IsJpeg(bytes) || IsWebP(bytes))
                    return padded;
            }
            catch (FormatException) { }
        }
        return null;
    }

    private static string ResolveOllamaBinary()
    {
        using var check = new Process();
        check.StartInfo = new ProcessStartInfo
        {
            FileName = OperatingSystem.IsWindows() ? "where" : "which",
            Arguments = "ollama",
            RedirectStandardOutput = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        try
        {
            check.Start();
            var result = check.StandardOutput.ReadLine()?.Trim();
            check.WaitForExit();
            if (!string.IsNullOrEmpty(result) && File.Exists(result)) return result;
        }
        catch { }

        foreach (var p in new[]
        {
            "/Applications/Ollama.app/Contents/Resources/ollama",
            "/usr/local/bin/ollama",
            "/opt/homebrew/bin/ollama",
            "/usr/bin/ollama",
        })
            if (File.Exists(p)) return p;

        return "ollama";
    }

    private static string Truncate(string s, int max) =>
        s.Length <= max ? s : s[..max] + "…";
}
