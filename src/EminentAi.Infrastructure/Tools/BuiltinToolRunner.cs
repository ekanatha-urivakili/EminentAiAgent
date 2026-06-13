using System.Diagnostics;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using EminentAi.Application.Abstractions;

namespace EminentAi.Infrastructure.Tools;

/// <summary>
/// Built-in "filesystem" and "shell" connectors so Agent mode works out of the box,
/// with no external MCP servers. Both are sandboxed to a configured workspace root;
/// the shell additionally enforces a command denylist and a hard timeout.
/// All mutations are surfaced as mutating so the orchestrator gates them behind approval.
/// </summary>
public sealed partial class BuiltinToolRunner : IBuiltinToolRunner
{
    private readonly string _workspaceRoot;
    private static readonly TimeSpan ShellTimeout = TimeSpan.FromSeconds(60);
    private const int MaxOutputChars = 12_000;
    private const long MaxReadBytes = 1_000_000;

    [GeneratedRegex(@"(rm\s+(-[a-z]*[rf][a-z]*\s+)+|sudo\b|mkfs|dd\s+if=|:\(\)\s*\{|chmod\s+777\s+/|curl[^|]*\|\s*(ba)?sh|wget[^|]*\|\s*(ba)?sh|>\s*/dev/sd|shutdown\b|reboot\b|launchctl\b|killall\b)", RegexOptions.IgnoreCase)]
    private static partial Regex DangerousCommand();

    public BuiltinToolRunner(BuiltinToolOptions options)
    {
        _workspaceRoot = Path.GetFullPath(string.IsNullOrWhiteSpace(options.WorkspaceRoot)
            ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "EminentAiWorkspace")
            : options.WorkspaceRoot);
        Directory.CreateDirectory(_workspaceRoot);
    }

    public bool Handles(string connectorName) =>
        connectorName.Equals("filesystem", StringComparison.OrdinalIgnoreCase) ||
        connectorName.Equals("shell", StringComparison.OrdinalIgnoreCase);

    public bool IsMutating(string connectorName, string toolName) =>
        connectorName.Equals("shell", StringComparison.OrdinalIgnoreCase) || // shell ALWAYS asks
        toolName is "write_file" or "delete_file" or "create_directory";

    public IReadOnlyList<ToolSchema> GetTools(string connectorName)
    {
        if (connectorName.Equals("shell", StringComparison.OrdinalIgnoreCase))
        {
            return new[]
            {
                Tool("shell.run", "Run a shell command inside the sandboxed workspace directory. Output is captured.",
                    ("command", "string", "The shell command to execute"))
            };
        }

        return new[]
        {
            Tool("filesystem.read_file", "Read a UTF-8 text file (workspace-relative path).",
                ("path", "string", "Workspace-relative file path")),
            Tool("filesystem.list_directory", "List files and folders at a workspace-relative path.",
                ("path", "string", "Workspace-relative directory path ('.' for root)")),
            Tool("filesystem.write_file", "Create or overwrite a UTF-8 text file (workspace-relative path).",
                ("path", "string", "Workspace-relative file path"),
                ("content", "string", "Full file content to write")),
            Tool("filesystem.search_files", "Recursively search file names matching a substring.",
                ("query", "string", "Case-insensitive substring of the file name"))
        };
    }

    public async Task<JsonNode> CallAsync(string connectorName, string toolName, JsonNode? args, CancellationToken ct = default)
    {
        var obj = args as JsonObject ?? new JsonObject();
        return connectorName.ToLowerInvariant() switch
        {
            "shell" when toolName == "run" => await RunShellAsync(GetArg(obj, "command"), ct),
            "filesystem" => toolName switch
            {
                "read_file" => ReadFile(GetArg(obj, "path")),
                "list_directory" => ListDirectory(GetArg(obj, "path", ".")),
                "write_file" => WriteFile(GetArg(obj, "path"), GetArg(obj, "content", "")),
                "search_files" => SearchFiles(GetArg(obj, "query")),
                _ => throw new ArgumentException($"Unknown filesystem tool '{toolName}'")
            },
            _ => throw new ArgumentException($"Unknown builtin tool '{connectorName}.{toolName}'")
        };
    }

    // ---- filesystem ----

    private string ResolveSafe(string relativePath)
    {
        if (string.IsNullOrWhiteSpace(relativePath)) relativePath = ".";
        var combined = Path.GetFullPath(Path.Combine(_workspaceRoot, relativePath));
        // Path-traversal guard: the resolved path must stay inside the workspace root.
        if (!combined.StartsWith(_workspaceRoot + Path.DirectorySeparatorChar, StringComparison.Ordinal)
            && combined != _workspaceRoot)
            throw new UnauthorizedAccessException($"Path '{relativePath}' escapes the workspace sandbox.");
        return combined;
    }

    private JsonNode ReadFile(string path)
    {
        var full = ResolveSafe(path);
        var info = new FileInfo(full);
        if (!info.Exists) throw new FileNotFoundException($"File not found: {path}");
        if (info.Length > MaxReadBytes)
            throw new InvalidOperationException($"File too large ({info.Length} bytes; limit {MaxReadBytes}).");
        var content = File.ReadAllText(full);
        return new JsonObject { ["path"] = path, ["content"] = Clamp(content) };
    }

    private JsonNode WriteFile(string path, string content)
    {
        var full = ResolveSafe(path);
        Directory.CreateDirectory(Path.GetDirectoryName(full)!);
        File.WriteAllText(full, content);
        return new JsonObject { ["path"] = path, ["bytesWritten"] = Encoding.UTF8.GetByteCount(content) };
    }

    private JsonNode ListDirectory(string path)
    {
        var full = ResolveSafe(path);
        if (!Directory.Exists(full)) throw new DirectoryNotFoundException($"Directory not found: {path}");
        var entries = new JsonArray();
        foreach (var dir in Directory.GetDirectories(full).Take(200))
            entries.Add(new JsonObject { ["name"] = Path.GetFileName(dir), ["type"] = "dir" });
        foreach (var file in Directory.GetFiles(full).Take(500))
            entries.Add(new JsonObject { ["name"] = Path.GetFileName(file), ["type"] = "file", ["size"] = new FileInfo(file).Length });
        return new JsonObject { ["path"] = path, ["entries"] = entries };
    }

    private JsonNode SearchFiles(string query)
    {
        if (string.IsNullOrWhiteSpace(query)) throw new ArgumentException("query is required");
        var hits = new JsonArray();
        var count = 0;
        foreach (var file in Directory.EnumerateFiles(_workspaceRoot, "*", new EnumerationOptions
        { RecurseSubdirectories = true, IgnoreInaccessible = true, MaxRecursionDepth = 12 }))
        {
            if (!Path.GetFileName(file).Contains(query, StringComparison.OrdinalIgnoreCase)) continue;
            hits.Add(Path.GetRelativePath(_workspaceRoot, file));
            if (++count >= 100) break;
        }
        return new JsonObject { ["query"] = query, ["matches"] = hits };
    }

    // ---- shell ----

    private async Task<JsonNode> RunShellAsync(string command, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(command)) throw new ArgumentException("command is required");
        if (DangerousCommand().IsMatch(command))
            throw new UnauthorizedAccessException("Command blocked by the shell denylist.");

        var isWindows = OperatingSystem.IsWindows();
        var psi = new ProcessStartInfo
        {
            FileName = isWindows ? "cmd.exe" : "/bin/bash",
            Arguments = isWindows ? $"/c {command}" : $"-c \"{command.Replace("\"", "\\\"")}\"",
            WorkingDirectory = _workspaceRoot,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true
        };
        psi.Environment["SUDO_ASKPASS"] = "/bin/false";

        using var process = Process.Start(psi)
            ?? throw new InvalidOperationException("Failed to start shell process");

        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeoutCts.CancelAfter(ShellTimeout);

        var stdoutTask = process.StandardOutput.ReadToEndAsync(timeoutCts.Token);
        var stderrTask = process.StandardError.ReadToEndAsync(timeoutCts.Token);
        try
        {
            await process.WaitForExitAsync(timeoutCts.Token);
        }
        catch (OperationCanceledException)
        {
            try { process.Kill(entireProcessTree: true); } catch { /* already gone */ }
            throw new TimeoutException($"Command timed out after {ShellTimeout.TotalSeconds:0}s and was killed.");
        }

        return new JsonObject
        {
            ["exitCode"] = process.ExitCode,
            ["stdout"] = Clamp(await stdoutTask),
            ["stderr"] = Clamp(await stderrTask)
        };
    }

    // ---- helpers ----

    private static string Clamp(string s) =>
        s.Length <= MaxOutputChars ? s : s[..MaxOutputChars] + $"… [truncated {s.Length - MaxOutputChars} chars]";

    private static string GetArg(JsonObject obj, string key, string? fallback = null) =>
        obj[key]?.GetValue<string>()
        ?? fallback
        ?? throw new ArgumentException($"Missing required argument '{key}'");

    private static ToolSchema Tool(string name, string description, params (string Name, string Type, string Desc)[] args)
    {
        var properties = new JsonObject();
        var required = new JsonArray();
        foreach (var (argName, type, desc) in args)
        {
            properties[argName] = new JsonObject { ["type"] = type, ["description"] = desc };
            required.Add(argName);
        }
        return new ToolSchema(name, description, new JsonObject
        {
            ["type"] = "object",
            ["properties"] = properties,
            ["required"] = required
        });
    }
}
