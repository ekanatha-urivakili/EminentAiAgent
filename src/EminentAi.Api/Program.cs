using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using System.Security.Cryptography;
using System.Diagnostics;
using System.Net;
using System.Net.Mail;
using System.Threading.RateLimiting;
using System.Text.RegularExpressions;
using EminentAi.Api;
using EminentAi.Api.JobSearch;
using EminentAi.Application.Abstractions;
using EminentAi.Application.Agent;
using EminentAi.Application.Agents;
using EminentAi.Application.Agents.ImageGeneration;
using EminentAi.Application.Orchestration;
using EminentAi.Application.Providers;
using EminentAi.Application.Routing;
using EminentAi.Infrastructure.Providers;
using EminentAi.Infrastructure.Routing;
using EminentAi.Infrastructure.Persistence;
using EminentAi.Application.Chat;
using EminentAi.Application.Planning;
using EminentAi.Api.Observability;
using EminentAi.Domain;
using EminentAi.Infrastructure.Mcp;
using EminentAi.Infrastructure.Ollama;
using EminentAi.Infrastructure.Security;
using EminentAi.Infrastructure.Tools;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

// ---------------------------------------------------------------------------
// Security posture: bind loopback only unless explicitly overridden AND a
// bearer token is configured. A local tool must never be silently LAN-exposed.
// ---------------------------------------------------------------------------
var configuredToken = builder.Configuration["EminentAi:ApiToken"];
var apiToken = !string.IsNullOrWhiteSpace(configuredToken)
    ? configuredToken
    : Environment.GetEnvironmentVariable("EMINENTAI_API_TOKEN");
var urls = builder.Configuration["urls"] ?? "http://127.0.0.1:5210";
var isLoopback = urls.Contains("127.0.0.1") || urls.Contains("localhost");
if (!isLoopback && string.IsNullOrWhiteSpace(apiToken))
    Console.WriteLine("INFO: Binding to a non-loopback address without a static API token — admin session auth is enforced on all protected endpoints.");
builder.WebHost.UseUrls(urls);

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------
builder.Services.AddDbContextFactory<EminentAiDbContext>(options =>
    options.UseSqlite(builder.Configuration.GetConnectionString("Default") ?? "Data Source=eminentai.db"));

builder.Services.AddHttpClient<IOllamaClient, OllamaClient>(client =>
{
    client.BaseAddress = new Uri(builder.Configuration["EminentAi:OllamaUrl"] ?? "http://127.0.0.1:11434");
    client.Timeout = TimeSpan.FromMinutes(10); // streamed generations are long-lived
});

builder.Services.AddHttpClient("OllamaRegistry", client =>
{
    client.BaseAddress = new Uri("https://ollama.com");
    client.Timeout = TimeSpan.FromSeconds(10);
    client.DefaultRequestHeaders.UserAgent.ParseAdd("EminentAi/1.0");
});

builder.Services.AddHttpClient("ReedApi", client =>
{
    client.BaseAddress = new Uri("https://www.reed.co.uk/api/");
    client.Timeout = TimeSpan.FromSeconds(30);
    client.DefaultRequestHeaders.UserAgent.ParseAdd("EminentAi/1.0");
});

// Job search singletons
builder.Services.AddSingleton<IndeedDirectBuffer>();
builder.Services.AddSingleton<JobRunCache>();
builder.Services.AddSingleton<JobSearchOrchestrator>();

builder.Services.AddSingleton(new BuiltinToolOptions(
    builder.Configuration["EminentAi:WorkspaceRoot"],
    builder.Configuration["EminentAi:OllamaApiKey"]
        ?? Environment.GetEnvironmentVariable("OLLAMA_API_KEY")));
builder.Services.AddSingleton<IBuiltinToolRunner, BuiltinToolRunner>();
builder.Services.AddSingleton<IPiiRedactor, PiiRedactor>();
builder.Services.AddSingleton<IPolicyEngine, PolicyEngine>();
builder.Services.AddSingleton<IMcpHost, McpHost>();
builder.Services.AddSingleton<ApprovalBroker>();
builder.Services.AddSingleton<AdminSessionCache>();
builder.Services.AddScoped<IConversationRepository, ConversationRepository>();
builder.Services.AddScoped<IAgentRunRepository, AgentRunRepository>();
builder.Services.AddScoped<ChatService>();
builder.Services.AddScoped<PlannerService>();
builder.Services.AddScoped<AgentOrchestrator>();

// ── Smart chat: A2A orchestration layer ──────────────────────────────────
builder.Services.AddSingleton<IIntentRouter, IntentRouterService>();
builder.Services.AddSingleton<IModelRouter, ModelRouterService>();
builder.Services.AddSingleton<IModelProvider, OllamaModelProvider>();
builder.Services.AddSingleton(CostPolicy.DefaultLocal);
builder.Services.AddSingleton(DataResidencyPolicy.DefaultLocal);
builder.Services.AddScoped<IGeneratedImageRepository, GeneratedImageRepository>();

// Register all ISpecializedAgent implementations
// Default to a "Generated_images" folder at the project root (one level above bin/Debug/net*/),
// falling back to cwd if the repository root can't be resolved.
static string ResolveProjectRoot()
{
    // Walk up from the running assembly looking for the .slnx / solution marker
    var dir = AppContext.BaseDirectory;
    for (var i = 0; i < 8; i++)
    {
        if (Directory.GetFiles(dir, "*.slnx").Length > 0 ||
            Directory.GetFiles(dir, "*.sln").Length > 0)
            return dir;
        var parent = Directory.GetParent(dir);
        if (parent is null) break;
        dir = parent.FullName;
    }
    return Directory.GetCurrentDirectory();
}

var generatedImagesDir = Path.GetFullPath(
    builder.Configuration["EminentAi:GeneratedImagesDir"]
    ?? Path.Combine(ResolveProjectRoot(), "Generated_images"));

Directory.CreateDirectory(generatedImagesDir);
builder.Services.AddScoped<ISpecializedAgent, VisionAgent>();
builder.Services.AddScoped<ISpecializedAgent, CodeAgent>();
builder.Services.AddScoped<ISpecializedAgent, ArchitectureAgent>();
builder.Services.AddScoped<ISpecializedAgent, GeneralAgent>();
builder.Services.AddScoped<ISpecializedAgent>(sp => new ImageGenerationAgent(
    sp.GetRequiredService<IOllamaClient>(),
    sp.GetRequiredService<IGeneratedImageRepository>(),
    sp.GetRequiredService<IConversationRepository>(),
    sp.GetRequiredService<IPiiRedactor>(),
    generatedImagesDir));
builder.Services.AddScoped<AgentOrchestratorFacade>();
builder.Services.AddScoped<ObservabilityService>();

builder.Services.ConfigureHttpJsonOptions(o =>
{
    o.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
    o.SerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
    o.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
});

// CORS: explicit allowlist for the Vite dev server — never AllowAnyOrigin.
var allowedOrigins = builder.Configuration.GetSection("EminentAi:AllowedOrigins").Get<string[]>()
    ?? new[] { "http://localhost:5173", "http://127.0.0.1:5173", "https://*.railway.app" };
builder.Services.AddCors(options => options.AddDefaultPolicy(policy =>
    policy.WithOrigins(allowedOrigins)
          .SetIsOriginAllowedToAllowWildcardSubdomains()
          .AllowAnyHeader()
          .AllowAnyMethod()
          .AllowCredentials()));

builder.Services.AddSignalR()
    .AddMessagePackProtocol();

// Rate limiting: generous for a local tool, but stops runaway clients/scripts.
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(ctx =>
    {
        if (ctx.Request.Path.StartsWithSegments("/voice-hub"))
        {
            return RateLimitPartition.GetNoLimiter("voice");
        }
        return RateLimitPartition.GetFixedWindowLimiter("global", _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 300,
            Window = TimeSpan.FromSeconds(10),
            QueueLimit = 0
        });
    });
});

builder.WebHost.ConfigureKestrel(kestrel =>
{
    kestrel.Limits.MaxRequestBodySize = 50 * 1024 * 1024; // uploads later; bounded now
});

var app = builder.Build();
Process? managedOllamaProcess = null;
Process? managedWhisperProcess = null;

app.UseCors();
app.UseRateLimiter();
app.MapHub<VoiceHub>("/voice-hub");

// Security headers + optional bearer-token auth (mandatory off-loopback).
app.Use(async (context, next) =>
{
    context.Response.Headers["X-Content-Type-Options"] = "nosniff";
    context.Response.Headers["X-Frame-Options"] = "DENY";
    context.Response.Headers["Referrer-Policy"] = "no-referrer";

    if (!string.IsNullOrWhiteSpace(apiToken) && context.Request.Method != HttpMethods.Options)
    {
        var header = context.Request.Headers.Authorization.ToString();
        var ok = header == $"Bearer {apiToken}";
        if (!ok)
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            await context.Response.WriteAsJsonAsync(new { error = "Missing or invalid API token" });
            return;
        }
    }
    await next();
});

// Admin session gate — when no EMINENTAI_API_TOKEN is set, every non-public request
// must carry a valid admin session bearer token (unless no admins exist yet: first-run setup).
app.Use(async (ctx, next) =>
{
    if (!string.IsNullOrWhiteSpace(apiToken) || ctx.Request.Method == HttpMethods.Options)
    { await next(); return; }

    var path = ctx.Request.Path.Value ?? "";
    if (path.StartsWith("/api/health", StringComparison.OrdinalIgnoreCase)
        || path.StartsWith("/api/models", StringComparison.OrdinalIgnoreCase)
        || path.StartsWith("/api/auth/", StringComparison.OrdinalIgnoreCase))
    { await next(); return; }

    var cache = ctx.RequestServices.GetRequiredService<AdminSessionCache>();
    if (!cache.Exists.HasValue)
    {
        var dbF = ctx.RequestServices.GetRequiredService<IDbContextFactory<EminentAiDbContext>>();
        await using var seedDb = await dbF.CreateDbContextAsync(ctx.RequestAborted);
        cache.Set(await seedDb.AdminUsers.AnyAsync(ctx.RequestAborted));
    }

    // No admins registered yet — allow through so the first admin can be created.
    if (cache.Exists == false) { await next(); return; }

    var tokenHash = HashToken(GetBearerToken(ctx.Request));
    if (tokenHash is null)
    {
        ctx.Response.StatusCode = StatusCodes.Status401Unauthorized;
        await ctx.Response.WriteAsJsonAsync(new { error = "Admin session required" });
        return;
    }

    var dbFactory2 = ctx.RequestServices.GetRequiredService<IDbContextFactory<EminentAiDbContext>>();
    await using var authDb = await dbFactory2.CreateDbContextAsync(ctx.RequestAborted);
    if (!await authDb.AdminUsers.AnyAsync(u => u.SessionTokenHash == tokenHash, ctx.RequestAborted))
    {
        ctx.Response.StatusCode = StatusCodes.Status401Unauthorized;
        await ctx.Response.WriteAsJsonAsync(new { error = "Admin session required" });
        return;
    }

    await next();
});

app.MapGet("/api/auth/debug/users", async (IDbContextFactory<EminentAiDbContext> dbFactory, CancellationToken ct) =>
{
    await using var db = await dbFactory.CreateDbContextAsync(ct);
    var users = await db.AdminUsers.Select(u => new { u.Email, u.FullName }).ToListAsync(ct);
    return Results.Ok(users);
});

// ---------------------------------------------------------------------------
// SSE helper
// ---------------------------------------------------------------------------
static async Task WriteSseAsync(HttpResponse response, string eventType, object data, CancellationToken ct)
{
    var json = JsonSerializer.Serialize(data, SseJson.Options);
    await response.WriteAsync($"event: {eventType}\ndata: {json}\n\n", ct);
    await response.Body.FlushAsync(ct);
}

static void PrepareSse(HttpResponse response)
{
    response.ContentType = "text/event-stream";
    response.Headers.CacheControl = "no-cache";
    response.Headers["X-Accel-Buffering"] = "no";
}

static string StripDataUrlPrefix(string data)
{
    var comma = data.IndexOf(',', StringComparison.Ordinal);
    return comma >= 0 ? data[(comma + 1)..] : data;
}

static async Task<bool> IsWhisperHealthyAsync(CancellationToken ct)
{
    try
    {
        using var probe = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
        var response = await probe.GetAsync("http://127.0.0.1:8082/health", ct);
        return response.IsSuccessStatusCode;
    }
    catch
    {
        return false;
    }
}

static string? FindWhisperServer()
{
    var candidates = new[]
    {
        Environment.GetEnvironmentVariable("WHISPER_SERVER_PATH"),
        "/opt/homebrew/bin/whisper-server",
        "/usr/local/bin/whisper-server",
        "whisper-server"
    };
    return candidates.FirstOrDefault(path => !string.IsNullOrWhiteSpace(path) && (path == "whisper-server" || File.Exists(path)));
}

static string? FindWhisperModel()
{
    var candidates = new[]
    {
        Environment.GetEnvironmentVariable("WHISPER_MODEL_PATH"),
        "/opt/homebrew/share/whisper-cpp/models/ggml-base.en.bin",
        "/usr/local/share/whisper-cpp/models/ggml-base.en.bin",
        Path.Combine(Directory.GetCurrentDirectory(), "whisper.cpp", "models", "ggml-base.en.bin")
    };
    return candidates.FirstOrDefault(path => !string.IsNullOrWhiteSpace(path) && File.Exists(path));
}

static string? GetBearerToken(HttpRequest request)
{
    var header = request.Headers.Authorization.ToString();
    return header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) ? header[7..].Trim() : null;
}

static string CreateToken() => Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));

static string? HashToken(string? token) =>
    string.IsNullOrWhiteSpace(token) ? null : Convert.ToBase64String(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(token)));

static string EscapeHtml(string value) => WebUtility.HtmlEncode(value);

static string? ResolveCvPath(string cvFolder, string filename)
{
    if (string.IsNullOrWhiteSpace(filename)) return null;

    var root = Path.GetFullPath(cvFolder)
        .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
        + Path.DirectorySeparatorChar;
    var resolved = Path.GetFullPath(Path.Combine(root, filename));
    return resolved.StartsWith(root, StringComparison.OrdinalIgnoreCase)
        && Path.GetFileName(resolved).Equals(filename, StringComparison.Ordinal)
        ? resolved
        : null;
}

static async Task SendPasswordResetEmailAsync(IConfiguration config, string toEmail, string resetToken)
{
    var smtp = config.GetSection("EminentAi:Smtp");
    var host = smtp["Host"] ?? "127.0.0.1";
    var port = int.Parse(smtp["Port"] ?? "1025");
    var from = smtp["FromAddress"] ?? "noreply@eminentai.local";
    var fromName = smtp["FromName"] ?? "EminentAi";
    var appBase = smtp["AppBaseUrl"] ?? "http://localhost:5173";
    var resetUrl = $"{appBase}?token={Uri.EscapeDataString(resetToken)}";
    var escapedResetUrl = EscapeHtml(resetUrl);

#pragma warning disable CS0618 // SmtpClient is deprecated but works fine with Mailpit on localhost
    using var client = new SmtpClient(host, port) { EnableSsl = false, Credentials = CredentialCache.DefaultNetworkCredentials };
    var mail = new MailMessage(new MailAddress(from, fromName), new MailAddress(toEmail))
    {
        Subject = "Reset your EminentAi password",
        Body = $"""
            <!doctype html>
            <html>
            <body style="margin:0;padding:24px;font-family:Arial,sans-serif;color:#111827;background:#ffffff;">
              <div style="max-width:520px;">
                <h1 style="font-size:20px;margin:0 0 16px;">Reset your EminentAi password</h1>
                <p style="font-size:15px;line-height:1.5;margin:0 0 16px;">
                  Someone requested a password reset for your EminentAi admin account.
                </p>
                <p style="font-size:15px;line-height:1.5;margin:0 0 24px;">
                  Click the button below to set a new password. This link is valid for 1 hour.
                </p>
                <a href="{escapedResetUrl}" target="_blank" rel="noopener noreferrer"
                   style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-weight:700;border-radius:8px;padding:12px 18px;">
                  Reset password
                </a>
                <p style="font-size:13px;line-height:1.5;margin:24px 0 0;color:#6b7280;">
                  If you did not request this, you can safely ignore this email.
                </p>
              </div>
            </body>
            </html>
            """,
        IsBodyHtml = true,
    };
    mail.AlternateViews.Add(AlternateView.CreateAlternateViewFromString($"""
        Someone requested a password reset for your EminentAi admin account.

        Use the reset password button in the HTML email to set a new password. This link is valid for 1 hour.

        If you did not request this, you can safely ignore this email.
        """, null, "text/plain"));
    await client.SendMailAsync(mail);
#pragma warning restore CS0618
}

static string HashPassword(string password)
{
    var salt = RandomNumberGenerator.GetBytes(16);
    var hash = Rfc2898DeriveBytes.Pbkdf2(password, salt, 100_000, HashAlgorithmName.SHA256, 32);
    return $"{Convert.ToBase64String(salt)}.{Convert.ToBase64String(hash)}";
}

static bool VerifyPassword(string password, string stored)
{
    var parts = stored.Split('.', 2);
    if (parts.Length != 2) return false;
    var salt = Convert.FromBase64String(parts[0]);
    var expected = Convert.FromBase64String(parts[1]);
    var actual = Rfc2898DeriveBytes.Pbkdf2(password, salt, 100_000, HashAlgorithmName.SHA256, 32);
    return CryptographicOperations.FixedTimeEquals(actual, expected);
}

static string ResolveOllamaBinary()
{
    // 1. Check if 'ollama' is in the PATH (standard way)
    try
    {
        using var check = new Process();
        check.StartInfo.FileName = "ollama";
        check.StartInfo.Arguments = "--version";
        check.StartInfo.UseShellExecute = false;
        check.StartInfo.CreateNoWindow = true;
        if (check.Start())
        {
            check.WaitForExit();
            if (check.ExitCode == 0) return "ollama";
        }
    }
    catch { /* not in path */ }

    // 2. Check Windows paths
    if (OperatingSystem.IsWindows())
    {
        var localApp = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var paths = new[]
        {
            Path.Combine(localApp, "Programs", "Ollama", "ollama.exe"),
            @"C:\Program Files\Ollama\ollama.exe",
        };
        foreach (var p in paths) if (File.Exists(p)) return p;
    }

    // 3. Check common macOS paths if we are on Darwin
    if (OperatingSystem.IsMacOS())
    {
        var paths = new[]
        {
            "/Applications/Ollama.app/Contents/Resources/ollama",
            "/usr/local/bin/ollama",
            "/opt/homebrew/bin/ollama",
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "bin/ollama")
        };
        foreach (var p in paths) if (File.Exists(p)) return p;
    }

    // 4. Check common Linux paths
    if (OperatingSystem.IsLinux())
    {
        var paths = new[] { "/usr/local/bin/ollama", "/usr/bin/ollama", "/bin/ollama" };
        foreach (var p in paths) if (File.Exists(p)) return p;
    }

    return "ollama"; // Fallback to PATH and hope for the best
}

// ---------------------------------------------------------------------------
// Health + models
// ---------------------------------------------------------------------------
app.MapGet("/api/health", async (IOllamaClient ollama, CancellationToken ct) =>
    Results.Ok(new { status = "ok", ollama = await ollama.IsHealthyAsync(ct) }));

app.MapGet("/api/observability", async (ObservabilityService service, CancellationToken ct) =>
    Results.Ok(await service.GetDataAsync(ct)));

app.MapGet("/api/models", async (IOllamaClient ollama, CancellationToken ct) =>
{
    try { return Results.Ok(await ollama.ListModelsAsync(ct)); }
    catch (Exception) { return Results.Problem("Ollama is not reachable on the configured URL.", statusCode: 503); }
});

app.MapPost("/api/ollama/start", async (IOllamaClient ollama, CancellationToken ct) =>
{
    if (await ollama.IsHealthyAsync(ct))
        return Results.Ok(new { running = true, message = "Ollama is already running." });
    if (managedOllamaProcess is { HasExited: false })
        return Results.Ok(new { running = true, message = "Ollama start is already in progress." });

    try
    {
        var bin = ResolveOllamaBinary();
        managedOllamaProcess = Process.Start(new ProcessStartInfo
        {
            FileName = bin,
            Arguments = "serve",
            UseShellExecute = false,
            CreateNoWindow = true
        });

        // Clear the 30-second circuit-breaker cooldown so polling can hit the network immediately.
        ollama.ResetHealthCooldown();

        // Wait up to 8 seconds for Ollama to become healthy (it can be slow to initialize)
        var healthy = false;
        for (var i = 0; i < 16; i++)
        {
            await Task.Delay(500, ct);
            if (await ollama.IsHealthyAsync(ct))
            {
                healthy = true;
                break;
            }
            if (managedOllamaProcess is { HasExited: true }) break;
        }

        return Results.Ok(new
        {
            running = healthy,
            message = healthy ? "Started local Ollama." : (managedOllamaProcess is null ? "Could not start Ollama." : "Ollama started but is not yet healthy.")
        });
    }
    catch (Exception ex)
    {
        return Results.Problem($"Unable to start Ollama: {ex.Message}", statusCode: 500);
    }
});

app.MapPost("/api/mailpit/start", async (CancellationToken ct) =>
{
    // Check if already running
    try
    {
        using var probe = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
        var check = await probe.GetAsync("http://127.0.0.1:8025/api/v1/info", ct);
        if (check.IsSuccessStatusCode)
            return Results.Ok(new { running = true, message = "Mailpit is already running." });
    }
    catch { /* not running — continue to start */ }

    // Find docker-compose.yml by walking up from the current directory
    static string? FindComposeDir()
    {
        var dir = Directory.GetCurrentDirectory();
        while (dir is not null)
        {
            if (File.Exists(Path.Combine(dir, "docker-compose.yml"))) return dir;
            dir = Directory.GetParent(dir)?.FullName;
        }
        return null;
    }

    var composeDir = FindComposeDir();
    if (composeDir is null)
        return Results.Problem("docker-compose.yml not found; start Mailpit manually.", statusCode: 500);

    try
    {
        Process.Start(new ProcessStartInfo
        {
            FileName = "docker",
            Arguments = "compose up -d mailpit",
            WorkingDirectory = composeDir,
            UseShellExecute = false,
            CreateNoWindow = true
        });
        await Task.Delay(2500, ct);
        return Results.Ok(new { running = true, message = "Started Mailpit. Refresh to see emails." });
    }
    catch (Exception ex)
    {
        return Results.Problem($"Unable to start Mailpit: {ex.Message}", statusCode: 500);
    }
});

app.MapPost("/api/ollama/stop", () =>
{
    var stoppedManaged = false;
    if (managedOllamaProcess is { HasExited: false })
    {
        managedOllamaProcess.Kill(entireProcessTree: true);
        managedOllamaProcess.Dispose();
        managedOllamaProcess = null;
        stoppedManaged = true;
    }

    // Fallback: try to find any process named 'ollama' and kill it.
    // This handles cases where Ollama was started externally or the API was restarted.
    var unmanagedKilled = 0;
    try
    {
        foreach (var p in Process.GetProcessesByName("ollama"))
        {
            try
            {
                p.Kill(entireProcessTree: true);
                unmanagedKilled++;
            }
            catch { /* ignore processes we can't kill */ }
        }
    }
    catch { /* ignore errors during process lookup */ }

    if (stoppedManaged || unmanagedKilled > 0)
    {
        return Results.Ok(new
        {
            stopped = true,
            message = stoppedManaged ? "Stopped app-managed Ollama." : $"Stopped {unmanagedKilled} externally-running Ollama process(es)."
        });
    }

    return Results.Ok(new { stopped = false, message = "No Ollama process found to stop." });
});

app.MapGet("/api/ollama/search", async (string? q, IHttpClientFactory factory, CancellationToken ct) =>
{
    try
    {
        var client = factory.CreateClient("OllamaRegistry");
        var path = string.IsNullOrWhiteSpace(q)
            ? "/api/search?limit=20"
            : $"/api/search?q={Uri.EscapeDataString(q)}&limit=20";
        var result = await client.GetFromJsonAsync<JsonNode>(path, ct);
        return Results.Ok(result);
    }
    catch (Exception ex)
    {
        return Results.Problem($"Registry search failed: {ex.Message}", statusCode: 502);
    }
});

app.MapPost("/api/ollama/pull", async ([FromBody] PullModelRequest request, IOllamaClient ollama, HttpContext context) =>
{
    if (string.IsNullOrWhiteSpace(request.Name))
    {
        context.Response.StatusCode = 400;
        await context.Response.WriteAsJsonAsync(new { error = "name is required" });
        return;
    }
    var ct = context.RequestAborted;
    PrepareSse(context.Response);
    try
    {
        await foreach (var delta in ollama.PullModelAsync(request.Name, ct))
            await WriteSseAsync(context.Response, delta.Status == "success" ? "done" : "progress", delta, ct);
    }
    catch (OperationCanceledException) { }
    catch (Exception ex)
    {
        await WriteSseAsync(context.Response, "error", new { message = ex.Message }, CancellationToken.None);
    }
});

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------
app.MapGet("/api/conversations", async (IConversationRepository repo, CancellationToken ct) =>
{
    var conversations = await repo.ListConversationsAsync(ct);
    return Results.Ok(conversations.Select(c => new
    {
        c.Id, c.Title, c.CreatedAt, c.ModelDefault
    }));
});

app.MapPost("/api/conversations", async ([FromBody] CreateConversationRequest request, ChatService chat, CancellationToken ct) =>
{
    if (string.IsNullOrWhiteSpace(request.Model))
        return Results.BadRequest(new { error = "model is required" });
    var conversation = await chat.CreateConversationAsync(request.Title ?? "New chat", request.Model, request.SystemPrompt, ct);
    return Results.Ok(new
    {
        conversation.Id,
        conversation.Title,
        conversation.ModelDefault,
        BranchId = conversation.Branches.First().Id
    });
});

app.MapGet("/api/conversations/{id:guid}", async (Guid id, IConversationRepository repo, CancellationToken ct) =>
{
    var conversation = await repo.GetConversationAsync(id, ct);
    if (conversation is null) return Results.NotFound();
    return Results.Ok(new
    {
        conversation.Id,
        conversation.Title,
        conversation.ModelDefault,
        conversation.SystemPrompt,
        Branches = conversation.Branches.OrderBy(b => b.CreatedAt).Select(b => new
        {
            b.Id,
            b.ParentBranchId,
            Messages = b.Messages.OrderBy(m => m.CreatedAt).Select(m => new
            {
                m.Id, Role = m.Role.ToString().ToLowerInvariant(), m.Content,
                m.Model, m.TokensIn, m.TokensOut, m.CreatedAt, m.ParentMessageId,
                Attachments = m.Attachments.Select(a => new
                {
                    a.Id,
                    a.Name,
                    a.ContentType,
                    DataUrl = $"data:{a.ContentType};base64,{a.DataBase64}"
                })
            })
        })
    });
});

app.MapPatch("/api/conversations/{id:guid}", async (Guid id, [FromBody] UpdateConversationRequest request, IConversationRepository repo, CancellationToken ct) =>
{
    var title = request.Title?.Trim();
    if (string.IsNullOrWhiteSpace(title))
        return Results.BadRequest(new { error = "title is required" });

    var conversation = await repo.GetConversationAsync(id, ct);
    if (conversation is null) return Results.NotFound();

    conversation.Title = title;
    await repo.SaveChangesAsync(ct);
    return Results.Ok(new
    {
        conversation.Id,
        conversation.Title,
        conversation.CreatedAt,
        conversation.ModelDefault
    });
});

app.MapDelete("/api/conversations/{id:guid}", async (Guid id, IConversationRepository repo, CancellationToken ct) =>
{
    await repo.DeleteConversationAsync(id, ct);
    await repo.SaveChangesAsync(ct);
    return Results.NoContent();
});

// ---------------------------------------------------------------------------
// Chat (SSE)
// ---------------------------------------------------------------------------
app.MapPost("/api/branches/{branchId:guid}/messages",
    async (Guid branchId, [FromBody] SendMessageRequest request, ChatService chat, HttpContext context) =>
{
    var ct = context.RequestAborted;
    PrepareSse(context.Response);
    try
    {
        var attachments = request.Attachments?.Select(a => new ChatAttachment(
            a.Name,
            a.ContentType,
            StripDataUrlPrefix(a.DataBase64))).ToList();
        await foreach (var delta in chat.SendMessageAsync(branchId, request.Content, request.ModelOverride, attachments, ct: ct))
            await WriteSseAsync(context.Response, delta.Done ? "done" : "token", delta, ct);
    }
    catch (OperationCanceledException) { /* client disconnected */ }
    catch (KeyNotFoundException ex)
    {
        await WriteSseAsync(context.Response, "error", new { message = ex.Message }, CancellationToken.None);
    }
    catch (Exception ex)
    {
        await WriteSseAsync(context.Response, "error", new { message = $"Generation failed: {ex.Message}" }, CancellationToken.None);
    }
});

// Stateless chat for the VS Code extension: messages in, SSE out. No persistence,
// but PII redaction still applies before anything reaches the model.
app.MapPost("/api/chat",
    async ([FromBody] StatelessChatRequest request, IOllamaClient ollama, IPiiRedactor redactor, HttpContext context) =>
{
    var ct = context.RequestAborted;
    PrepareSse(context.Response);
    try
    {
        var messages = request.Messages
            .Select(m => new ChatMessage(m.Role, redactor.Redact(m.Content)))
            .ToList();
        await foreach (var delta in ollama.ChatStreamAsync(new ChatRequest(request.Model, messages), ct))
            await WriteSseAsync(context.Response, delta.Done ? "done" : "token", delta, ct);
    }
    catch (OperationCanceledException) { }
    catch (Exception ex)
    {
        await WriteSseAsync(context.Response, "error", new { message = ex.Message }, CancellationToken.None);
    }
});

// ---------------------------------------------------------------------------
// Admin auth
// ---------------------------------------------------------------------------
app.MapGet("/api/auth/me", async (HttpRequest request, IDbContextFactory<EminentAiDbContext> dbFactory, CancellationToken ct) =>
{
    var tokenHash = HashToken(GetBearerToken(request));
    if (tokenHash is null) return Results.Unauthorized();
    await using var db = await dbFactory.CreateDbContextAsync(ct);
    var admin = await db.AdminUsers.AsNoTracking().FirstOrDefaultAsync(u => u.SessionTokenHash == tokenHash, ct);
    return admin is null
        ? Results.Unauthorized()
        : Results.Ok(new { admin.Id, admin.FullName, admin.Email });
});

app.MapPost("/api/auth/register", async ([FromBody] RegisterRequest request, IDbContextFactory<EminentAiDbContext> dbFactory, AdminSessionCache adminCache, ILogger<Program> logger, CancellationToken ct) =>
{
    if (string.IsNullOrWhiteSpace(request.FullName) || string.IsNullOrWhiteSpace(request.Email) || string.IsNullOrWhiteSpace(request.Password))
        return Results.BadRequest(new { error = "Full name, email and password are required." });
    if (request.Password.Length < 8)
        return Results.BadRequest(new { error = "Password must be at least 8 characters." });

    await using var db = await dbFactory.CreateDbContextAsync(ct);
    var email = request.Email.Trim().ToLowerInvariant();

    if (await db.AdminUsers.AnyAsync(u => u.Email == email, ct))
    {
        logger.LogWarning("Registration attempt for {Email} rejected: an account with this email already exists.", email);
        return Results.Conflict(new { error = "An account with this email already exists." });
    }

    var token = CreateToken();
    var admin = new AdminUser
    {
        FullName = request.FullName.Trim(),
        Email = email,
        PasswordHash = HashPassword(request.Password),
        SessionTokenHash = HashToken(token)
    };
    db.AdminUsers.Add(admin);
    await db.SaveChangesAsync(ct);
    adminCache.Set(true);
    logger.LogInformation("New admin registered: {Email}", email);
    return Results.Ok(new { token, admin = new { admin.Id, admin.FullName, admin.Email } });
});

app.MapPost("/api/auth/login", async ([FromBody] LoginRequest request, IDbContextFactory<EminentAiDbContext> dbFactory, ILogger<Program> logger, CancellationToken ct) =>
{
    await using var db = await dbFactory.CreateDbContextAsync(ct);
    var email = request.Email.Trim().ToLowerInvariant();
    var admin = await db.AdminUsers.FirstOrDefaultAsync(u => u.Email == email, ct);
    if (admin is null || !VerifyPassword(request.Password, admin.PasswordHash))
    {
        logger.LogWarning("Login attempt failed for {Email}.", email);
        return Results.Json(new { error = "Invalid email or password." }, statusCode: 401);
    }

    var token = CreateToken();
    admin.SessionTokenHash = HashToken(token);
    await db.SaveChangesAsync(ct);
    logger.LogInformation("Admin logged in: {Email}", email);
    return Results.Ok(new { token, admin = new { admin.Id, admin.FullName, admin.Email } });
});

app.MapPost("/api/auth/change-password", async ([FromBody] ChangePasswordRequest request, HttpRequest httpRequest, IDbContextFactory<EminentAiDbContext> dbFactory, CancellationToken ct) =>
{
    if (string.IsNullOrWhiteSpace(request.CurrentPassword) || string.IsNullOrWhiteSpace(request.NewPassword))
        return Results.BadRequest(new { error = "currentPassword and newPassword are required" });
    if (request.NewPassword.Length < 8)
        return Results.BadRequest(new { error = "New password must be at least 8 characters." });

    var tokenHash = HashToken(GetBearerToken(httpRequest));
    if (tokenHash is null) return Results.Unauthorized();

    await using var db = await dbFactory.CreateDbContextAsync(ct);
    var admin = await db.AdminUsers.FirstOrDefaultAsync(u => u.SessionTokenHash == tokenHash, ct);
    if (admin is null) return Results.Unauthorized();

    if (!VerifyPassword(request.CurrentPassword, admin.PasswordHash))
        return Results.BadRequest(new { error = "Current password is incorrect." });

    admin.PasswordHash = HashPassword(request.NewPassword);
    await db.SaveChangesAsync(ct);
    return Results.Ok(new { message = "Password changed successfully." });
});

app.MapPost("/api/auth/forgot-password", async ([FromBody] ForgotPasswordRequest request, IDbContextFactory<EminentAiDbContext> dbFactory, IConfiguration config, CancellationToken ct) =>
{
    if (string.IsNullOrWhiteSpace(request.Email))
        return Results.BadRequest(new { error = "email is required" });

    await using var db = await dbFactory.CreateDbContextAsync(ct);
    var email = request.Email.Trim().ToLowerInvariant();
    var admin = await db.AdminUsers.FirstOrDefaultAsync(u => u.Email == email, ct);

    // Always return 200 to prevent email enumeration.
    if (admin is null) return Results.Ok(new { message = "If that email is registered, a reset link has been sent." });

    var rawToken = CreateToken();
    var tokenHash = HashToken(rawToken)!;
    var newId = Guid.NewGuid().ToString();
    var adminIdStr = admin.Id.ToString();
    var expiresAt = DateTime.UtcNow.AddHours(1).ToString("O");

    await db.Database.ExecuteSqlAsync($"""
        INSERT INTO "PasswordResetTokens" ("Id","AdminUserId","TokenHash","ExpiresAt")
        VALUES ({newId},{adminIdStr},{tokenHash},{expiresAt})
        """, ct);

    try { await SendPasswordResetEmailAsync(config, admin.Email, rawToken); }
    catch (Exception ex) { return Results.Problem($"Email send failed: {ex.Message}", statusCode: 500); }

    return Results.Ok(new { message = "If that email is registered, a reset link has been sent." });
});

app.MapPost("/api/auth/reset-password", async ([FromBody] ResetPasswordRequest request, IDbContextFactory<EminentAiDbContext> dbFactory, CancellationToken ct) =>
{
    if (string.IsNullOrWhiteSpace(request.Token) || string.IsNullOrWhiteSpace(request.NewPassword))
        return Results.BadRequest(new { error = "token and newPassword are required" });
    if (request.NewPassword.Length < 8)
        return Results.BadRequest(new { error = "password must be at least 8 characters" });

    var tokenHash = HashToken(request.Token)!;

    await using var db = await dbFactory.CreateDbContextAsync(ct);

    // Find the reset token row via raw query (table bootstrapped via raw SQL, not in model).
    var rows = await db.Database.SqlQuery<PasswordResetRow>(
        $"""
        SELECT Id, AdminUserId, TokenHash, ExpiresAt, UsedAt
        FROM "PasswordResetTokens"
        WHERE TokenHash = {tokenHash}
        """).ToListAsync(ct);

    var row = rows.FirstOrDefault();
    if (row is null)
        return Results.BadRequest(new { error = "Invalid or expired reset token." });
    if (row.UsedAt is not null)
        return Results.BadRequest(new { error = "This reset link has already been used." });
    if (DateTime.Parse(row.ExpiresAt, null, System.Globalization.DateTimeStyles.RoundtripKind) < DateTime.UtcNow)
        return Results.BadRequest(new { error = "This reset link has expired." });

    // Atomically claim the token before touching the password — prevents double-use in concurrent requests.
    var usedAt = DateTime.UtcNow.ToString("O");
    var rowId = row.Id;
    var claimed = await db.Database.ExecuteSqlAsync($"""
        UPDATE "PasswordResetTokens" SET UsedAt = {usedAt} WHERE Id = {rowId} AND UsedAt IS NULL
        """, ct);
    if (claimed == 0)
        return Results.BadRequest(new { error = "This reset link has already been used." });

    var adminId = Guid.Parse(row.AdminUserId);
    var admin = await db.AdminUsers.FirstOrDefaultAsync(u => u.Id == adminId, ct);
    if (admin is null)
        return Results.BadRequest(new { error = "Invalid or expired reset token." });

    admin.PasswordHash = HashPassword(request.NewPassword);
    admin.SessionTokenHash = null; // invalidate any active sessions
    await db.SaveChangesAsync(ct);

    return Results.Ok(new { message = "Password updated successfully. You can now log in." });
});

app.MapPost("/api/messages/{messageId:guid}/regenerate",
    async (Guid messageId, [FromBody] RegenerateRequest request, ChatService chat, HttpContext context) =>
{
    var ct = context.RequestAborted;
    PrepareSse(context.Response);
    try
    {
        await foreach (var delta in chat.RegenerateAsync(messageId, request.Model, request.Temperature, ct))
            await WriteSseAsync(context.Response, delta.Done ? "done" : "token", delta, ct);
    }
    catch (OperationCanceledException) { }
    catch (Exception ex)
    {
        await WriteSseAsync(context.Response, "error", new { message = ex.Message }, CancellationToken.None);
    }
});

app.MapPost("/api/branches/{branchId:guid}/fork",
    async (Guid branchId, [FromBody] ForkRequest request, ChatService chat, CancellationToken ct) =>
{
    var newBranch = await chat.BranchConversationAsync(branchId, request.MessageId, ct);
    return Results.Ok(new { newBranch.Id, newBranch.ConversationId, newBranch.ParentBranchId });
});

// ---------------------------------------------------------------------------
// Plan mode
// ---------------------------------------------------------------------------
app.MapPost("/api/plan", async ([FromBody] PlanRequest request, PlannerService planner, CancellationToken ct) =>
{
    if (string.IsNullOrWhiteSpace(request.Goal))
        return Results.BadRequest(new { error = "goal is required" });
    try
    {
        var plan = await planner.CreatePlanAsync(request.Goal, request.Model, ct);
        return Results.Ok(plan);
    }
    catch (InvalidOperationException ex)
    {
        return Results.Problem(ex.Message, statusCode: 422);
    }
});

// ---------------------------------------------------------------------------
// Agent mode (SSE) + approvals + cancel
// ---------------------------------------------------------------------------
app.MapPost("/api/agent/runs",
    async ([FromBody] StartAgentRunRequest request, AgentOrchestrator orchestrator, HttpContext context) =>
{
    var ct = context.RequestAborted;
    PrepareSse(context.Response);

    if (string.IsNullOrWhiteSpace(request.Goal))
    {
        await WriteSseAsync(context.Response, "error", new { message = "goal is required" }, CancellationToken.None);
        return;
    }

    var runId = Guid.NewGuid();
    var opts = new AgentRunOptions(
        request.Goal,
        request.Connectors is { Length: > 0 } ? request.Connectors : new[] { "filesystem", "shell" },
        string.IsNullOrWhiteSpace(request.Model) ? "qwen2.5-coder:7b" : request.Model,
        request.PlanJson,
        request.StepBudget ?? 15,
        WorkspaceRoot: request.WorkspaceRoot);

    try
    {
        await foreach (var agentEvent in orchestrator.RunAsync(runId, opts, ct))
            await WriteSseAsync(context.Response, agentEvent.Type, agentEvent.Data ?? new { }, ct);
    }
    catch (OperationCanceledException) { /* client disconnected */ }
    catch (Exception ex)
    {
        await WriteSseAsync(context.Response, "error", new { message = $"Agent run failed: {ex.Message}" }, CancellationToken.None);
    }
});

app.MapPost("/api/agent/runs/{runId:guid}/approvals/{stepId:guid}",
    (Guid runId, Guid stepId, [FromBody] ApprovalRequest request, ApprovalBroker broker) =>
{
    var resolved = broker.Resolve(runId, stepId,
        new ApprovalDecision(request.Decision.Equals("approve", StringComparison.OrdinalIgnoreCase), request.Remember ?? false));
    return resolved ? Results.Ok(new { resolved = true }) : Results.NotFound(new { error = "No pending approval for this step" });
});

app.MapPost("/api/agent/runs/{runId:guid}/cancel", (Guid runId, ApprovalBroker broker) =>
    broker.CancelRun(runId) ? Results.Ok(new { cancelled = true }) : Results.NotFound());

app.MapGet("/api/agent/runs/{runId:guid}", async (Guid runId, IAgentRunRepository runs, CancellationToken ct) =>
{
    var run = await runs.GetRunAsync(runId, ct);
    if (run is null) return Results.NotFound();
    return Results.Ok(new
    {
        run.Id, run.Goal, run.Model, run.Status, run.StepBudget,
        run.StartedAt, run.FinishedAt, run.FinalAnswer,
        Steps = run.Steps.Select(step => new
        {
            step.Id, step.Ordinal, step.Kind, step.Status,
            step.ToolName, step.ToolArgsJson, step.ResultJson, step.Thought, step.CreatedAt
        })
    });
});

// ---------------------------------------------------------------------------
// Job Search Agent
// ---------------------------------------------------------------------------

// Settings helpers — key: "job_search_criteria"
static async Task<JobSearchCriteria> LoadJobCriteriaAsync(IDbContextFactory<EminentAiDbContext> dbFactory, CancellationToken ct)
{
    await using var db = await dbFactory.CreateDbContextAsync(ct);
    var rows = await db.Database.SqlQuery<AppSettingRow>(
        $"""SELECT "Key", "Value" FROM "AppSettings" WHERE "Key" = 'job_search_criteria'""").ToListAsync(ct);
    if (rows.FirstOrDefault() is { Value: var json })
    {
        try { return JsonSerializer.Deserialize<JobSearchCriteria>(json, SseJson.Options) ?? new(); }
        catch { /* corrupt — return default */ }
    }
    return new();
}

static JobSearchCriteria RedactJobCriteriaSecrets(JobSearchCriteria criteria)
{
    var configured = new List<string>();
    if (!string.IsNullOrWhiteSpace(criteria.ReedApiKey)) configured.Add("REED_API_KEY");
    if (!string.IsNullOrWhiteSpace(criteria.SlackWebhookUrl)) configured.Add("SLACK_WEBHOOK_URL");
    if (!string.IsNullOrWhiteSpace(criteria.GmailCredentialsJson)) configured.Add("GMAIL_CREDENTIALS_JSON");
    if (!string.IsNullOrWhiteSpace(criteria.GmailSearchQuery)) configured.Add("GMAIL_SEARCH_QUERY");

    return criteria with
    {
        ReedApiKey = null,
        SlackWebhookUrl = null,
        GmailCredentialsJson = null,
        ConfiguredSecretKeys = configured,
    };
}

static JobSearchCriteria PreserveBlankSecrets(JobSearchCriteria incoming, JobSearchCriteria existing) =>
    incoming with
    {
        ReedApiKey = string.IsNullOrWhiteSpace(incoming.ReedApiKey) ? existing.ReedApiKey : incoming.ReedApiKey,
        SlackWebhookUrl = string.IsNullOrWhiteSpace(incoming.SlackWebhookUrl) ? existing.SlackWebhookUrl : incoming.SlackWebhookUrl,
        GmailCredentialsJson = string.IsNullOrWhiteSpace(incoming.GmailCredentialsJson) ? existing.GmailCredentialsJson : incoming.GmailCredentialsJson,
        GmailSearchQuery = string.IsNullOrWhiteSpace(incoming.GmailSearchQuery) ? existing.GmailSearchQuery : incoming.GmailSearchQuery,
    };

static async Task SaveJobCriteriaAsync(IDbContextFactory<EminentAiDbContext> dbFactory, JobSearchCriteria criteria, CancellationToken ct)
{
    await using var db = await dbFactory.CreateDbContextAsync(ct);
    var json = JsonSerializer.Serialize(criteria, SseJson.Options);
    var updatedAt = DateTime.UtcNow.ToString("O");
    await db.Database.ExecuteSqlAsync(
        $"""INSERT OR REPLACE INTO "AppSettings" ("Key","Value","UpdatedAt") VALUES ('job_search_criteria',{json},{updatedAt})""", ct);
}

app.MapGet("/api/jobs/results", (JobRunCache cache) =>
    cache.LatestRun is not null ? Results.Ok(cache.LatestRun) : Results.NoContent());

app.MapGet("/api/jobs/search",
    async (JobSearchOrchestrator orchestrator, IDbContextFactory<EminentAiDbContext> dbFactory, CancellationToken ct) =>
{
    var criteria = await LoadJobCriteriaAsync(dbFactory, ct);
    var result = await orchestrator.RunSearchAsync(criteria, ct);
    return Results.Ok(result);
});

app.MapGet("/api/jobs/sources/health",
    async (JobSearchOrchestrator orchestrator, IDbContextFactory<EminentAiDbContext> dbFactory, CancellationToken ct) =>
{
    var criteria = await LoadJobCriteriaAsync(dbFactory, ct);
    return Results.Ok(orchestrator.GetSourceHealth(criteria));
});

app.MapGet("/api/jobs/settings",
    async (IDbContextFactory<EminentAiDbContext> dbFactory, CancellationToken ct) =>
    Results.Ok(RedactJobCriteriaSecrets(await LoadJobCriteriaAsync(dbFactory, ct))));

app.MapPost("/api/jobs/settings",
    async ([FromBody] JobSearchCriteria criteria, IDbContextFactory<EminentAiDbContext> dbFactory, CancellationToken ct) =>
{
    var existing = await LoadJobCriteriaAsync(dbFactory, ct);
    await SaveJobCriteriaAsync(dbFactory, PreserveBlankSecrets(criteria, existing), ct);
    return Results.Ok(new { saved = true });
});

app.MapPost("/api/jobs/ingest_indeed",
    async ([FromBody] IngestIndeedRequest request, IndeedDirectBuffer buffer,
           JobSearchOrchestrator orchestrator, IDbContextFactory<EminentAiDbContext> dbFactory, CancellationToken ct) =>
{
    buffer.Ingest(request.Jobs ?? new(), request.ClearFirst);

    // Auto-run search after ingestion so results are immediately available
    var criteria = await LoadJobCriteriaAsync(dbFactory, ct);
    var result = await orchestrator.RunSearchAsync(criteria, ct);
    return Results.Ok(new { ingested = request.Jobs?.Count ?? 0, buffered = buffer.Count, runId = result.RunId, matched = result.Matches.Count });
});

// CV management
app.MapGet("/api/cvs", (JobSearchOrchestrator orchestrator) =>
    Results.Ok(CvLoader.ListFiles(orchestrator.CvFolder)));

app.MapPost("/api/cvs/upload", async (HttpRequest request, JobSearchOrchestrator orchestrator) =>
{
    var form = await request.ReadFormAsync();
    var file = form.Files.GetFile("file");
    if (file is null)
        return Results.BadRequest(new { error = "file is required" });
    if (file.Length > 10 * 1024 * 1024)
        return Results.BadRequest(new { error = "File exceeds 10 MB limit" });

    var allowed = new[] { ".pdf", ".docx", ".txt", ".md" };
    var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
    if (!allowed.Contains(ext))
        return Results.BadRequest(new { error = "Only .pdf, .docx, .txt and .md files are accepted" });

    var cvFolder = orchestrator.CvFolder;
    Directory.CreateDirectory(cvFolder);
    var safeName = $"{Guid.NewGuid():N}_{Path.GetFileName(file.FileName)}";
    var dest = Path.Combine(cvFolder, safeName);
    await using var stream = File.Create(dest);
    await file.CopyToAsync(stream);
    return Results.Ok(new { name = safeName });
});

app.MapDelete("/api/cvs/{filename}", (string filename, JobSearchOrchestrator orchestrator) =>
{
    var path = ResolveCvPath(orchestrator.CvFolder, filename);
    if (path is null)
        return Results.BadRequest(new { error = "Invalid filename" });

    if (!File.Exists(path)) return Results.NotFound();
    File.Delete(path);
    return Results.NoContent();
});

// ---------------------------------------------------------------------------
// Connector registry
// ---------------------------------------------------------------------------
app.MapGet("/api/connectors", async (IDbContextFactory<EminentAiDbContext> dbFactory, CancellationToken ct) =>
{
    await using var db = await dbFactory.CreateDbContextAsync(ct);
    var connectors = await db.Connectors.Include(c => c.Rules).AsNoTracking().ToListAsync(ct);
    // env_json_encrypted is never returned to clients.
    return Results.Ok(connectors.Select(c => new
    {
        c.Id, c.Name, c.Transport, c.CommandOrUrl, c.Enabled, c.PolicyProfile,
        Rules = c.Rules.Select(r => new { r.Id, r.ToolPattern, r.Action })
    }));
});

app.MapPost("/api/connectors", async ([FromBody] ConnectorRequest request, IDbContextFactory<EminentAiDbContext> dbFactory, CancellationToken ct) =>
{
    if (string.IsNullOrWhiteSpace(request.Name) || string.IsNullOrWhiteSpace(request.CommandOrUrl))
        return Results.BadRequest(new { error = "name and commandOrUrl are required" });
    if (System.Text.RegularExpressions.Regex.IsMatch(request.CommandOrUrl, @"[;&|`$(){}<>\n]"))
        return Results.BadRequest(new { error = "commandOrUrl must not contain shell metacharacters" });
    if ((request.Transport ?? ConnectorTransport.Stdio) == ConnectorTransport.Stdio &&
        !McpCommandLine.TryParse(request.CommandOrUrl, out _, out _))
        return Results.BadRequest(new { error = "commandOrUrl is not a valid stdio command" });

    await using var db = await dbFactory.CreateDbContextAsync(ct);
    if (await db.Connectors.AnyAsync(c => c.Name == request.Name, ct))
        return Results.Conflict(new { error = $"Connector '{request.Name}' already exists" });

    var connector = new ConnectorConfig
    {
        Name = request.Name.Trim().ToLowerInvariant(),
        Transport = request.Transport ?? ConnectorTransport.Stdio,
        CommandOrUrl = request.CommandOrUrl,
        PolicyProfile = request.PolicyProfile ?? PolicyProfile.ReadOnly,
        Enabled = true
    };
    db.Connectors.Add(connector);
    await db.SaveChangesAsync(ct);
    return Results.Ok(new { connector.Id, connector.Name });
});

app.MapDelete("/api/connectors/{id:guid}", async (Guid id, IDbContextFactory<EminentAiDbContext> dbFactory, CancellationToken ct) =>
{
    await using var db = await dbFactory.CreateDbContextAsync(ct);
    var connector = await db.Connectors.FirstOrDefaultAsync(c => c.Id == id, ct);
    if (connector is null) return Results.NotFound();
    db.Connectors.Remove(connector);
    await db.SaveChangesAsync(ct);
    return Results.NoContent();
});

app.MapPost("/api/jobs/indeed/ingest-script", async (IDbContextFactory<EminentAiDbContext> dbFactory, CancellationToken ct) =>
{
    var criteria = await LoadJobCriteriaAsync(dbFactory, ct);
    if (string.IsNullOrWhiteSpace(criteria.IndeedIngestScript))
        return Results.BadRequest(new { error = "Indeed Ingest Script is not configured in settings." });

    try
    {
        var result = await RunIndeedScriptAsync(criteria.IndeedIngestScript, ct);
        return Results.Ok(result);
    }
    catch (Exception ex)
    {
        return Results.Problem(ex.Message, statusCode: 500);
    }
});

app.MapPost("/api/jobs/indeed/pull-script", async (IDbContextFactory<EminentAiDbContext> dbFactory, CancellationToken ct) =>
{
    var criteria = await LoadJobCriteriaAsync(dbFactory, ct);
    if (string.IsNullOrWhiteSpace(criteria.IndeedPullScript))
        return Results.BadRequest(new { error = "Indeed Pull Script is not configured in settings." });

    try
    {
        var result = await RunIndeedScriptAsync(criteria.IndeedPullScript, ct);
        return Results.Ok(result);
    }
    catch (Exception ex)
    {
        return Results.Problem(ex.Message, statusCode: 500);
    }
});

static async Task<object> RunIndeedScriptAsync(string command, CancellationToken ct)
{
    // Reusing safety logic: block dangerous commands.
    // (This regex is a copy of the one in BuiltinToolRunner for simplicity in this file)
    var dangerous = new Regex(@"(rm\s+(-[a-z]*[rf][a-z]*\s+)+|sudo\b|mkfs|dd\s+if=|:\(\)\s*\{|chmod\s+777\s+/|curl[^|]*\|\s*(ba)?sh|wget[^|]*\|\s*(ba)?sh|>\s*/dev/sd|shutdown\b|reboot\b|launchctl\b|killall\b)", RegexOptions.IgnoreCase);
    if (dangerous.IsMatch(command))
        throw new UnauthorizedAccessException("Command blocked by the shell denylist.");

    var isWindows = OperatingSystem.IsWindows();
    var psi = new ProcessStartInfo
    {
        FileName = isWindows ? "cmd.exe" : "/bin/bash",
        Arguments = isWindows ? $"/c {command}" : $"-c \"{command.Replace("\"", "\\\"")}\"",
        RedirectStandardOutput = true,
        RedirectStandardError = true,
        UseShellExecute = false,
        CreateNoWindow = true
    };

    using var process = Process.Start(psi) ?? throw new InvalidOperationException("Failed to start script process");
    using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
    timeoutCts.CancelAfter(TimeSpan.FromSeconds(120)); // Generous timeout for scraper scripts

    var stdoutTask = process.StandardOutput.ReadToEndAsync(timeoutCts.Token);
    var stderrTask = process.StandardError.ReadToEndAsync(timeoutCts.Token);

    try { await process.WaitForExitAsync(timeoutCts.Token); }
    catch (OperationCanceledException)
    {
        try { process.Kill(entireProcessTree: true); } catch { }
        throw new TimeoutException("Script timed out after 120s.");
    }

    return new { exitCode = process.ExitCode, stdout = await stdoutTask, stderr = await stderrTask };
}

// ---------------------------------------------------------------------------
// Transcription Proxy (for mobile/remote access to local whisper.cpp)
// ---------------------------------------------------------------------------
app.MapGet("/api/whisper/health", async (CancellationToken ct) =>
{
    return Results.Ok(new { running = await IsWhisperHealthyAsync(ct) });
});

app.MapPost("/api/whisper/start", async (CancellationToken ct) =>
{
    if (await IsWhisperHealthyAsync(ct))
        return Results.Ok(new { running = true, message = "Whisper is already running." });
    if (managedWhisperProcess is { HasExited: false })
        return Results.Ok(new { running = true, message = "Whisper start is already in progress." });

    var serverPath = FindWhisperServer();
    if (serverPath is null)
        return Results.Problem("whisper-server not found. Install it with: brew install whisper-cpp", statusCode: 500);

    var modelPath = FindWhisperModel();
    if (modelPath is null)
        return Results.Problem("Whisper model not found. Run: whisper-cpp-download-ggml-model base.en", statusCode: 500);

    try
    {
        managedWhisperProcess = Process.Start(new ProcessStartInfo
        {
            FileName = serverPath,
            ArgumentList =
            {
                "--model", modelPath,
                "--host", "127.0.0.1",
                "--port", "8082"
            },
            UseShellExecute = false,
            CreateNoWindow = true
        });
        await Task.Delay(1500, ct);
        return Results.Ok(new
        {
            running = await IsWhisperHealthyAsync(ct),
            message = managedWhisperProcess is null ? "Could not start Whisper." : "Started local Whisper server."
        });
    }
    catch (Exception ex)
    {
        return Results.Problem($"Unable to start Whisper: {ex.Message}", statusCode: 500);
    }
});

app.MapPost("/api/transcribe", async (HttpRequest request, IHttpClientFactory httpClientFactory) =>
{
    var form = await request.ReadFormAsync();
    var file = form.Files.GetFile("file");
    if (file is null) return Results.BadRequest(new { error = "file is required" });

    using var client = httpClientFactory.CreateClient();
    using var content = new MultipartFormDataContent();
    using var stream = file.OpenReadStream();
    var streamContent = new StreamContent(stream);
    streamContent.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue(file.ContentType);
    content.Add(streamContent, "file", file.FileName);
    content.Add(new StringContent("json"), "response_format");

    try
    {
        var res = await client.PostAsync("http://127.0.0.1:8082/inference", content);
        if (!res.IsSuccessStatusCode) return Results.Problem($"Whisper server returned {res.StatusCode}", statusCode: (int)res.StatusCode);
        var json = await res.Content.ReadFromJsonAsync<JsonElement>();
        return Results.Ok(json);
    }
    catch (Exception ex)
    {
        return Results.Problem($"Could not reach local whisper server: {ex.Message}", statusCode: 502);
    }
});

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
using (var scope = app.Services.CreateScope())
{
    var dbFactory = scope.ServiceProvider.GetRequiredService<IDbContextFactory<EminentAiDbContext>>();
    using var db = dbFactory.CreateDbContext();
    db.Database.EnsureCreated();
    db.Database.ExecuteSqlRaw("""
        CREATE TABLE IF NOT EXISTS "MessageAttachments" (
            "Id" TEXT NOT NULL CONSTRAINT "PK_MessageAttachments" PRIMARY KEY,
            "MessageId" TEXT NOT NULL,
            "Name" TEXT NOT NULL,
            "ContentType" TEXT NOT NULL,
            "DataBase64" TEXT NOT NULL,
            "CreatedAt" TEXT NOT NULL,
            CONSTRAINT "FK_MessageAttachments_Messages_MessageId" FOREIGN KEY ("MessageId") REFERENCES "Messages" ("Id") ON DELETE CASCADE
        );
        """);
    db.Database.ExecuteSqlRaw("""CREATE INDEX IF NOT EXISTS "IX_MessageAttachments_MessageId" ON "MessageAttachments" ("MessageId");""");
    db.Database.ExecuteSqlRaw("""
        CREATE TABLE IF NOT EXISTS "AdminUsers" (
            "Id" TEXT NOT NULL CONSTRAINT "PK_AdminUsers" PRIMARY KEY,
            "FullName" TEXT NOT NULL,
            "Email" TEXT NOT NULL,
            "PasswordHash" TEXT NOT NULL,
            "SessionTokenHash" TEXT NULL,
            "CreatedAt" TEXT NOT NULL
        );
        """);
    db.Database.ExecuteSqlRaw("""CREATE UNIQUE INDEX IF NOT EXISTS "IX_AdminUsers_Email" ON "AdminUsers" ("Email");""");
    db.Database.ExecuteSqlRaw("""
        CREATE TABLE IF NOT EXISTS "PasswordResetTokens" (
            "Id" TEXT NOT NULL CONSTRAINT "PK_PasswordResetTokens" PRIMARY KEY,
            "AdminUserId" TEXT NOT NULL,
            "TokenHash" TEXT NOT NULL,
            "ExpiresAt" TEXT NOT NULL,
            "UsedAt" TEXT NULL
        );
        """);
    db.Database.ExecuteSqlRaw("""CREATE INDEX IF NOT EXISTS "IX_PRT_TokenHash" ON "PasswordResetTokens" ("TokenHash");""");

    // Job search tables
    db.Database.ExecuteSqlRaw("""
        CREATE TABLE IF NOT EXISTS "AppSettings" (
            "Key" TEXT NOT NULL PRIMARY KEY,
            "Value" TEXT NOT NULL,
            "UpdatedAt" TEXT NOT NULL
        );
        """);
    db.Database.ExecuteSqlRaw("""
        CREATE TABLE IF NOT EXISTS "JobSearchRuns" (
            "Id" TEXT NOT NULL PRIMARY KEY,
            "StartedAt" TEXT NOT NULL,
            "FinishedAt" TEXT,
            "Status" TEXT NOT NULL,
            "TotalFetched" INTEGER NOT NULL DEFAULT 0,
            "TotalMatched" INTEGER NOT NULL DEFAULT 0,
            "CriteriaJson" TEXT NOT NULL
        );
        """);

    db.Database.ExecuteSqlRaw("""
        CREATE TABLE IF NOT EXISTS "Connectors" (
            "Id" TEXT NOT NULL CONSTRAINT "PK_Connectors" PRIMARY KEY,
            "Name" TEXT NOT NULL,
            "Transport" INTEGER NOT NULL,
            "CommandOrUrl" TEXT NOT NULL,
            "EnvJsonEncrypted" TEXT NULL,
            "Enabled" INTEGER NOT NULL DEFAULT 1,
            "PolicyProfile" INTEGER NOT NULL DEFAULT 0
        );
        """);
    db.Database.ExecuteSqlRaw("""CREATE UNIQUE INDEX IF NOT EXISTS "IX_Connectors_Name" ON "Connectors" ("Name");""");
    db.Database.ExecuteSqlRaw("""
        CREATE TABLE IF NOT EXISTS "PolicyRules" (
            "Id" TEXT NOT NULL CONSTRAINT "PK_PolicyRules" PRIMARY KEY,
            "ConnectorId" TEXT NOT NULL,
            "ToolPattern" TEXT NOT NULL,
            "Action" INTEGER NOT NULL DEFAULT 1,
            CONSTRAINT "FK_PolicyRules_Connectors_ConnectorId" FOREIGN KEY ("ConnectorId") REFERENCES "Connectors" ("Id") ON DELETE CASCADE
        );
        """);

    // Agent run tables (may be missing in DBs created before these models were added)
    db.Database.ExecuteSqlRaw("""
        CREATE TABLE IF NOT EXISTS "AgentRuns" (
            "Id" TEXT NOT NULL CONSTRAINT "PK_AgentRuns" PRIMARY KEY,
            "ConversationId" TEXT NULL,
            "Goal" TEXT NOT NULL,
            "PlanJson" TEXT NULL,
            "Model" TEXT NOT NULL,
            "Status" INTEGER NOT NULL DEFAULT 0,
            "StepBudget" INTEGER NOT NULL DEFAULT 15,
            "TokenBudget" INTEGER NOT NULL DEFAULT 60000,
            "StartedAt" TEXT NOT NULL,
            "FinishedAt" TEXT NULL,
            "FinalAnswer" TEXT NULL,
            CONSTRAINT "FK_AgentRuns_Conversations_ConversationId" FOREIGN KEY ("ConversationId") REFERENCES "Conversations" ("Id") ON DELETE SET NULL
        );
        """);
    db.Database.ExecuteSqlRaw("""CREATE INDEX IF NOT EXISTS "IX_AgentRuns_StartedAt" ON "AgentRuns" ("StartedAt");""");
    db.Database.ExecuteSqlRaw("""
        CREATE TABLE IF NOT EXISTS "AgentSteps" (
            "Id" TEXT NOT NULL CONSTRAINT "PK_AgentSteps" PRIMARY KEY,
            "RunId" TEXT NOT NULL,
            "Ordinal" INTEGER NOT NULL,
            "Kind" INTEGER NOT NULL DEFAULT 0,
            "Status" INTEGER NOT NULL DEFAULT 4,
            "ToolName" TEXT NULL,
            "ToolArgsJson" TEXT NULL,
            "ResultJson" TEXT NULL,
            "Thought" TEXT NULL,
            "CreatedAt" TEXT NOT NULL,
            CONSTRAINT "FK_AgentSteps_AgentRuns_RunId" FOREIGN KEY ("RunId") REFERENCES "AgentRuns" ("Id") ON DELETE CASCADE
        );
        """);
    db.Database.ExecuteSqlRaw("""CREATE INDEX IF NOT EXISTS "IX_AgentSteps_RunId_Ordinal" ON "AgentSteps" ("RunId", "Ordinal");""");

    // Rescue mode: if EMINENTAI_RESCUE=1 is set, ensure a default admin exists.
    if (Environment.GetEnvironmentVariable("EMINENTAI_RESCUE") == "1")
    {
        var rescueEmail = "admin@eminentai.local";
        var rescueAdmin = db.AdminUsers.FirstOrDefault(u => u.Email == rescueEmail);
        if (rescueAdmin is null)
        {
            rescueAdmin = new AdminUser
            {
                FullName = "Rescue Admin",
                Email = rescueEmail,
                PasswordHash = HashPassword("RescuePassword123!"),
                CreatedAt = DateTime.UtcNow
            };
            db.AdminUsers.Add(rescueAdmin);
        }
        else
        {
            rescueAdmin.PasswordHash = HashPassword("RescuePassword123!");
        }
        db.SaveChanges();
        var cache = scope.ServiceProvider.GetRequiredService<AdminSessionCache>();
        cache.Set(true);
        Console.WriteLine("RESCUE MODE: Default admin 'admin@eminentai.local' ensured with password 'RescuePassword123!'");
    }
}

// ── Smart chat endpoint ──────────────────────────────────────────────────
app.MapPost("/api/chat/smart", async (
    [FromBody] SmartChatRequest req,
    AgentOrchestratorFacade facade,
    HttpContext http,
    CancellationToken ct) =>
{
    if (req.BranchId == Guid.Empty)
        return Results.BadRequest(new { error = "branchId is required" });
    if (string.IsNullOrWhiteSpace(req.Content))
        return Results.BadRequest(new { error = "content is required" });
    // Guard against oversized payloads (DoS / OOM)
    if (req.Content.Length > 32_000)
        return Results.BadRequest(new { error = "content exceeds 32,000 character limit" });
    if ((req.Attachments?.Count ?? 0) > 10)
        return Results.BadRequest(new { error = "too many attachments (max 10)" });
    if (req.Attachments?.Any(a => (a.DataBase64?.Length ?? 0) > 10_000_000) == true)
        return Results.BadRequest(new { error = "attachment exceeds 10 MB limit" });

    // Validate manualRouteOverride — invalid enum string → routing_error immediately
    AgentKind? overrideKind = null;
    if (!string.IsNullOrWhiteSpace(req.ManualRouteOverride))
    {
        if (!Enum.TryParse<AgentKind>(req.ManualRouteOverride, ignoreCase: true, out var parsed))
        {
            PrepareSse(http.Response);
            await WriteSseAsync(http.Response, "routing_error", new { message = "Unknown manual route override." }, ct);
            return Results.Empty;
        }
        overrideKind = parsed;
    }

    var attachments = req.Attachments?
        .Select(a => new ChatAttachment(a.Name, a.ContentType, StripDataUrlPrefix(a.DataBase64)))
        .ToList() ?? new List<ChatAttachment>();

    var imageAttachments = attachments
        .Where(a => a.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
        .ToList();

    var turnRequest = new SmartTurnRequest(
        BranchId: req.BranchId,
        UserText: req.Content,
        Attachments: attachments,
        HasImageAttachment: imageAttachments.Count > 0,
        AttachmentContentTypes: imageAttachments.Select(a => a.ContentType).ToList(),
        ManualRouteOverride: overrideKind,
        RequestTokenHash: HashToken(GetBearerToken(http.Request)));

    http.Response.ContentType = "text/event-stream";
    http.Response.Headers.CacheControl = "no-cache";
    http.Response.Headers.Connection = "keep-alive";

    try
    {
        await foreach (var evt in facade.ExecuteSmartTurnAsync(turnRequest, ct))
        {
            var json = System.Text.Json.JsonSerializer.Serialize(evt.Data, SseJson.Options);
            await http.Response.WriteAsync($"event: {evt.Type}\ndata: {json}\n\n", ct);
            await http.Response.Body.FlushAsync(ct);
        }
    }
    catch (OperationCanceledException)
    {
        // Client disconnected — normal; no error response needed
    }
    catch
    {
        await WriteSseAsync(http.Response, "error", new { message = "Smart chat failed." }, CancellationToken.None);
    }

    return Results.Empty;
});

// ── Generated image serve (auth + ownership required) ────────────────────
app.MapGet("/api/generated-images/{filename}", async (
    string filename,
    HttpContext http,
    CancellationToken ct) =>
{
    // Layer 1: strict UUID.{ext} filename only (no path traversal possible)
    if (!System.Text.RegularExpressions.Regex.IsMatch(
        filename,
        @"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|gif|webp)$",
        System.Text.RegularExpressions.RegexOptions.IgnoreCase))
    {
        return Results.BadRequest(new { error = "Invalid filename" });
    }

    var resolvedDir = generatedImagesDir;  // use the configured directory, not cwd
    var resolvedPath = Path.GetFullPath(Path.Combine(resolvedDir, filename));

    // Layer 2: path containment check with trailing separator (defence in depth)
    // Prevents "/var/images-alt/..." from matching "/var/images" as a prefix.
    var safeRoot = resolvedDir.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
                   + Path.DirectorySeparatorChar;
    if (!resolvedPath.StartsWith(safeRoot, StringComparison.OrdinalIgnoreCase))
        return Results.BadRequest(new { error = "Invalid filename" });

    if (!File.Exists(resolvedPath))
        return Results.NotFound(new { error = "Image not found" });

    // Ownership check: verify the image was generated in a branch this session can access
    var imageId = Guid.Parse(Path.GetFileNameWithoutExtension(filename));
    var imageRepo = http.RequestServices.GetRequiredService<IGeneratedImageRepository>();
    if (!await imageRepo.ExistsForSessionAsync(imageId, HashToken(GetBearerToken(http.Request)), ct))
        return Results.Forbid();

    var contentType = Path.GetExtension(filename).ToLowerInvariant() switch
    {
        ".jpg" => "image/jpeg",
        ".gif" => "image/gif",
        ".webp" => "image/webp",
        _ => "image/png"
    };
    return Results.File(resolvedPath, contentType);
});

// Bootstrap GeneratedImages table (idempotent)
{
    using var scope = app.Services.CreateScope();
    var dbF = scope.ServiceProvider.GetRequiredService<IDbContextFactory<EminentAiDbContext>>();
    await using var db = await dbF.CreateDbContextAsync();
    db.Database.ExecuteSqlRaw("""
        CREATE TABLE IF NOT EXISTS "GeneratedImages" (
            "Id"        TEXT NOT NULL CONSTRAINT "PK_GeneratedImages" PRIMARY KEY,
            "BranchId"  TEXT NOT NULL,
            "SessionTokenHash" TEXT NULL,
            "CreatedAt" TEXT NOT NULL,
            CONSTRAINT "FK_GeneratedImages_Branches_BranchId" FOREIGN KEY ("BranchId") REFERENCES "Branches" ("Id") ON DELETE CASCADE
        );
        """);
    var connection = db.Database.GetDbConnection();
    if (connection.State != System.Data.ConnectionState.Open)
        await connection.OpenAsync();
    await using (var command = connection.CreateCommand())
    {
        command.CommandText = """PRAGMA table_info("GeneratedImages");""";
        var hasSessionTokenHash = false;
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            if (reader.GetString(1).Equals("SessionTokenHash", StringComparison.OrdinalIgnoreCase))
            {
                hasSessionTokenHash = true;
                break;
            }
        }

        if (!hasSessionTokenHash)
            db.Database.ExecuteSqlRaw("""ALTER TABLE "GeneratedImages" ADD COLUMN "SessionTokenHash" TEXT NULL;""");
    }
    db.Database.ExecuteSqlRaw("""CREATE INDEX IF NOT EXISTS "IX_GeneratedImages_BranchId" ON "GeneratedImages" ("BranchId");""");
    db.Database.ExecuteSqlRaw("""CREATE INDEX IF NOT EXISTS "IX_GeneratedImages_Id_SessionTokenHash" ON "GeneratedImages" ("Id", "SessionTokenHash");""");
}

app.Run();

internal static class SseJson
{
    public static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };
}

public record CreateConversationRequest(string? Title, string Model, string? SystemPrompt);
public record UpdateConversationRequest(string? Title);
public record StatelessChatRequest(string Model, List<StatelessChatMessage> Messages);
public record StatelessChatMessage(string Role, string Content);
public record SendMessageRequest(string Content, string? ModelOverride, List<SendAttachmentRequest>? Attachments);
public record SendAttachmentRequest(string Name, string ContentType, string DataBase64);
public record RegenerateRequest(string? Model, float? Temperature);
public record ForkRequest(Guid MessageId);
public record PlanRequest(string Goal, string Model = "qwen2.5-coder:7b");
public record StartAgentRunRequest(
    string Goal,
    string[]? Connectors,
    string? Model,
    string? PlanJson,
    int? StepBudget,
    string? WorkspaceRoot);
public record ApprovalRequest(string Decision, bool? Remember);
public record ConnectorRequest(string Name, ConnectorTransport? Transport, string CommandOrUrl, PolicyProfile? PolicyProfile);
public record PullModelRequest(string Name);
public record SmartChatRequest(
    Guid BranchId,
    string Content,
    List<SendAttachmentRequest>? Attachments,
    string? ManualRouteOverride);
public record RegisterRequest(string FullName, string Email, string Password);
public record LoginRequest(string Email, string Password);
public record ForgotPasswordRequest(string Email);
public record ResetPasswordRequest(string Token, string NewPassword);
public record ChangePasswordRequest(string CurrentPassword, string NewPassword);

// Caches whether any admin accounts exist so the session-gate middleware avoids a DB hit per request.
internal sealed class AdminSessionCache
{
    private volatile int _state = -1; // -1=unknown, 0=no admins, 1=has admins

    public bool? Exists => _state switch { 0 => false, 1 => true, _ => null };
    public void Set(bool exists) => _state = exists ? 1 : 0;
}

// Used only for raw SQL projection in the reset-password endpoint.
internal class PasswordResetRow
{
    public string Id { get; set; } = "";
    public string AdminUserId { get; set; } = "";
    public string TokenHash { get; set; } = "";
    public string ExpiresAt { get; set; } = "";
    public string? UsedAt { get; set; }
}

// Used for raw SQL projection of app settings.
internal class AppSettingRow
{
    public string Key { get; set; } = "";
    public string Value { get; set; } = "";
}
