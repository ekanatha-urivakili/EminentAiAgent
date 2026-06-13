using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using System.Security.Cryptography;
using System.Diagnostics;
using System.Net;
using System.Net.Mail;
using System.Threading.RateLimiting;
using EminentAi.Api.JobSearch;
using EminentAi.Application.Abstractions;
using EminentAi.Application.Agent;
using EminentAi.Application.Chat;
using EminentAi.Application.Planning;
using EminentAi.Domain;
using EminentAi.Infrastructure.Mcp;
using EminentAi.Infrastructure.Ollama;
using EminentAi.Infrastructure.Persistence;
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
    throw new InvalidOperationException(
        "Refusing to bind a non-loopback address without EMINENTAI_API_TOKEN set (see architecture N4).");
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

builder.Services.AddSingleton(new BuiltinToolOptions(builder.Configuration["EminentAi:WorkspaceRoot"]));
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

builder.Services.ConfigureHttpJsonOptions(o =>
{
    o.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
    o.SerializerOptions.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
    o.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
});

// CORS: explicit allowlist for the Vite dev server — never AllowAnyOrigin.
var allowedOrigins = builder.Configuration.GetSection("EminentAi:AllowedOrigins").Get<string[]>()
    ?? new[] { "http://localhost:5173", "http://127.0.0.1:5173" };
builder.Services.AddCors(options => options.AddDefaultPolicy(policy =>
    policy.WithOrigins(allowedOrigins)
          .AllowAnyHeader()
          .AllowAnyMethod()));

// Rate limiting: generous for a local tool, but stops runaway clients/scripts.
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(ctx =>
        RateLimitPartition.GetFixedWindowLimiter("global", _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 300,
            Window = TimeSpan.FromSeconds(10),
            QueueLimit = 0
        }));
});

builder.WebHost.ConfigureKestrel(kestrel =>
{
    kestrel.Limits.MaxRequestBodySize = 50 * 1024 * 1024; // uploads later; bounded now
});

var app = builder.Build();
Process? managedOllamaProcess = null;

app.UseCors();
app.UseRateLimiter();

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

static string? GetBearerToken(HttpRequest request)
{
    var header = request.Headers.Authorization.ToString();
    return header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) ? header[7..].Trim() : null;
}

static string CreateToken() => Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));

static string? HashToken(string? token) =>
    string.IsNullOrWhiteSpace(token) ? null : Convert.ToBase64String(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(token)));

static async Task SendPasswordResetEmailAsync(IConfiguration config, string toEmail, string resetToken)
{
    var smtp = config.GetSection("EminentAi:Smtp");
    var host = smtp["Host"] ?? "127.0.0.1";
    var port = int.Parse(smtp["Port"] ?? "1025");
    var from = smtp["FromAddress"] ?? "noreply@eminentai.local";
    var fromName = smtp["FromName"] ?? "EminentAi";
    var appBase = smtp["AppBaseUrl"] ?? "http://localhost:5173";
    var resetUrl = $"{appBase}?token={Uri.EscapeDataString(resetToken)}";

#pragma warning disable CS0618 // SmtpClient is deprecated but works fine with Mailpit on localhost
    using var client = new SmtpClient(host, port) { EnableSsl = false, Credentials = CredentialCache.DefaultNetworkCredentials };
    var mail = new MailMessage(new MailAddress(from, fromName), new MailAddress(toEmail))
    {
        Subject = "Reset your EminentAi password",
        Body = $"""
            Someone requested a password reset for your EminentAi admin account.

            Click the link below to set a new password (valid for 1 hour):
            {resetUrl}

            If you did not request this, you can safely ignore this email.
            """,
        IsBodyHtml = false,
    };
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

// ---------------------------------------------------------------------------
// Health + models
// ---------------------------------------------------------------------------
app.MapGet("/api/health", async (IOllamaClient ollama, CancellationToken ct) =>
    Results.Ok(new { status = "ok", ollama = await ollama.IsHealthyAsync(ct) }));

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
        managedOllamaProcess = Process.Start(new ProcessStartInfo
        {
            FileName = "ollama",
            Arguments = "serve",
            UseShellExecute = false,
            CreateNoWindow = true
        });
        await Task.Delay(1200, ct);
        return Results.Ok(new
        {
            running = await ollama.IsHealthyAsync(ct),
            message = managedOllamaProcess is null ? "Could not start Ollama." : "Started local Ollama."
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
    if (managedOllamaProcess is null)
        return Results.Ok(new { stopped = false, message = "No app-managed Ollama process is running." });
    if (managedOllamaProcess.HasExited)
        return Results.Ok(new { stopped = true, message = "App-managed Ollama process already stopped." });

    managedOllamaProcess.Kill(entireProcessTree: true);
    managedOllamaProcess.Dispose();
    managedOllamaProcess = null;
    return Results.Ok(new { stopped = true, message = "Stopped app-managed Ollama." });
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
        await foreach (var delta in chat.SendMessageAsync(branchId, request.Content, request.ModelOverride, attachments, ct))
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

app.MapPost("/api/auth/register", async ([FromBody] RegisterRequest request, IDbContextFactory<EminentAiDbContext> dbFactory, AdminSessionCache adminCache, CancellationToken ct) =>
{
    if (string.IsNullOrWhiteSpace(request.FullName) || string.IsNullOrWhiteSpace(request.Email) || string.IsNullOrWhiteSpace(request.Password))
        return Results.BadRequest(new { error = "fullName, email and password are required" });
    if (request.Password.Length < 8)
        return Results.BadRequest(new { error = "password must be at least 8 characters" });

    await using var db = await dbFactory.CreateDbContextAsync(ct);
    var email = request.Email.Trim().ToLowerInvariant();
    if (await db.AdminUsers.AnyAsync(u => u.Email == email, ct))
        return Results.Conflict(new { error = "admin already exists" });

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
    return Results.Ok(new { token, admin = new { admin.Id, admin.FullName, admin.Email } });
});

app.MapPost("/api/auth/login", async ([FromBody] LoginRequest request, IDbContextFactory<EminentAiDbContext> dbFactory, CancellationToken ct) =>
{
    await using var db = await dbFactory.CreateDbContextAsync(ct);
    var email = request.Email.Trim().ToLowerInvariant();
    var admin = await db.AdminUsers.FirstOrDefaultAsync(u => u.Email == email, ct);
    if (admin is null || !VerifyPassword(request.Password, admin.PasswordHash))
        return Results.Unauthorized();

    var token = CreateToken();
    admin.SessionTokenHash = HashToken(token);
    await db.SaveChangesAsync(ct);
    return Results.Ok(new { token, admin = new { admin.Id, admin.FullName, admin.Email } });
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
        request.StepBudget ?? 15);

    try
    {
        await foreach (var agentEvent in orchestrator.RunAsync(runId, opts, ct))
            await WriteSseAsync(context.Response, agentEvent.Type, agentEvent.Data ?? new { }, ct);
    }
    catch (OperationCanceledException) { /* client disconnected */ }
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
    // Prevent path traversal
    if (filename.Contains('/') || filename.Contains('\\') || filename.Contains(".."))
        return Results.BadRequest(new { error = "Invalid filename" });

    var path = Path.Combine(orchestrator.CvFolder, filename);
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
public record StatelessChatRequest(string Model, List<StatelessChatMessage> Messages);
public record StatelessChatMessage(string Role, string Content);
public record SendMessageRequest(string Content, string? ModelOverride, List<SendAttachmentRequest>? Attachments);
public record SendAttachmentRequest(string Name, string ContentType, string DataBase64);
public record RegenerateRequest(string? Model, float? Temperature);
public record ForkRequest(Guid MessageId);
public record PlanRequest(string Goal, string Model = "qwen2.5-coder:7b");
public record StartAgentRunRequest(string Goal, string[]? Connectors, string? Model, string? PlanJson, int? StepBudget);
public record ApprovalRequest(string Decision, bool? Remember);
public record ConnectorRequest(string Name, ConnectorTransport? Transport, string CommandOrUrl, PolicyProfile? PolicyProfile);
public record PullModelRequest(string Name);
public record RegisterRequest(string FullName, string Email, string Password);
public record LoginRequest(string Email, string Password);
public record ForgotPasswordRequest(string Email);
public record ResetPasswordRequest(string Token, string NewPassword);

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
