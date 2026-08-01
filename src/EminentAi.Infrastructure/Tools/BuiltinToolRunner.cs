using System.Diagnostics;
using System.IO.Compression;
using System.Linq;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using EminentAi.Application.Abstractions;
using EminentAi.Application.Agents.ImageGeneration;

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
    private readonly string? _ollamaApiKey;
    private static readonly HttpClient WebClient = new()
    {
        BaseAddress = new Uri("https://ollama.com"),
        Timeout = TimeSpan.FromSeconds(30)
    };
    private static readonly TimeSpan ShellTimeout = TimeSpan.FromSeconds(60);
    private const int MaxOutputChars = 12_000;
    private const long MaxReadBytes = 1_000_000;

    [GeneratedRegex(@"(rm\s+(-[a-z]*[rf][a-z]*\s+)+|sudo\b|mkfs|dd\s+if=|:\(\)\s*\{|chmod\s+777\s+/|curl[^|]*\|\s*(ba)?sh|wget[^|]*\|\s*(ba)?sh|>\s*/dev/sd|shutdown\b|reboot\b|launchctl\b|killall\b)", RegexOptions.IgnoreCase)]
    private static partial Regex DangerousCommand();

    public BuiltinToolRunner(BuiltinToolOptions options)
    {
        _workspaceRoot = NormalizeExistingRoot(string.IsNullOrWhiteSpace(options.WorkspaceRoot)
            ? FindWorkspaceRoot()
            : options.WorkspaceRoot);
        _ollamaApiKey = options.OllamaApiKey;
        Directory.CreateDirectory(_workspaceRoot);
    }

    public bool Handles(string connectorName) =>
        connectorName.Equals("filesystem", StringComparison.OrdinalIgnoreCase) ||
        connectorName.Equals("shell", StringComparison.OrdinalIgnoreCase) ||
        connectorName.Equals("web", StringComparison.OrdinalIgnoreCase) ||
        connectorName.Equals("image", StringComparison.OrdinalIgnoreCase);

    public bool IsMutating(string connectorName, string toolName) =>
        connectorName.Equals("shell", StringComparison.OrdinalIgnoreCase) || // shell ALWAYS asks
        connectorName.Equals("image", StringComparison.OrdinalIgnoreCase) || // writes a file
        toolName is "write_file" or "replace_in_file" or "delete_path" or
            "move_path" or "create_directory" or "create_zip";

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
        if (connectorName.Equals("web", StringComparison.OrdinalIgnoreCase))
        {
            return new[]
            {
                Tool("web.search", "Search the public web. Results include titles, URLs, and snippets that must be cited.",
                    ("query", "string", "Search query")),
                Tool("web.fetch", "Fetch readable content from one public HTTP or HTTPS URL.",
                    ("url", "string", "Public page URL from search results"))
            };
        }
        if (connectorName.Equals("image", StringComparison.OrdinalIgnoreCase))
        {
            return new[]
            {
                Tool("image.generate",
                    "Generate an image from a text prompt with a local diffusion model and save it into " +
                    "the workspace. Takes 30-180 seconds. If the user attached a reference image, describe " +
                    "what it shows in the prompt (subject, style, colours, composition).",
                    ("prompt", "string", "Detailed visual description: subject, style, colours, composition"),
                    ("filename", "string", "Workspace-relative output path, e.g. 'generated/logo.png'"))
            };
        }

        return new[]
        {
            Tool("filesystem.read_file", "Read a UTF-8 text file (workspace-relative path).",
                ("path", "string", "Workspace-relative file path")),
            Tool("filesystem.list_directory", "List files and folders at a workspace-relative path.",
                ("path", "string", "Workspace-relative directory path ('.' for root)")),
            Tool("filesystem.list_tree", "Recursively list the workspace tree, excluding generated and VCS directories.",
                ("path", "string", "Workspace-relative directory path ('.' for root)")),
            Tool("filesystem.write_file", "Create or overwrite a UTF-8 text file (workspace-relative path).",
                ("path", "string", "Workspace-relative file path"),
                ("content", "string", "Full file content to write")),
            Tool("filesystem.replace_in_file", "Replace one exact, unique text block in a UTF-8 file. Read the file first.",
                ("path", "string", "Workspace-relative file path"),
                ("oldText", "string", "Exact existing text; it must occur exactly once"),
                ("newText", "string", "Replacement text")),
            Tool("filesystem.create_directory", "Create a directory under the workspace.",
                ("path", "string", "Workspace-relative directory path")),
            Tool("filesystem.move_path", "Move or rename a file or directory inside the workspace.",
                ("source", "string", "Existing workspace-relative path"),
                ("destination", "string", "New workspace-relative path")),
            Tool("filesystem.delete_path", "Delete one file or an empty directory inside the workspace.",
                ("path", "string", "Workspace-relative path")),
            Tool("filesystem.create_zip", "Create a ZIP archive from one workspace file or directory.",
                ("source", "string", "Workspace-relative file or directory"),
                ("output", "string", "Workspace-relative output path ending in .zip")),
            Tool("filesystem.search_files", "Recursively search file names matching a substring.",
                ("query", "string", "Case-insensitive substring of the file name")),
            Tool("filesystem.search_content", "Recursively search UTF-8 file contents and return matching lines.",
                ("query", "string", "Case-insensitive text to find"))
        };
    }

    public async Task<JsonNode> CallAsync(
        string connectorName,
        string toolName,
        JsonNode? args,
        string? workspaceRoot = null,
        CancellationToken ct = default)
    {
        var obj = args as JsonObject ?? new JsonObject();
        var root = ResolveWorkspaceRoot(workspaceRoot);
        return connectorName.ToLowerInvariant() switch
        {
            "shell" when toolName == "run" => await RunShellAsync(GetArg(obj, "command"), root, ct),
            "web" when toolName == "search" => await SearchWebAsync(GetArg(obj, "query"), ct),
            "web" when toolName == "fetch" => await FetchWebAsync(GetArg(obj, "url"), ct),
            "image" when toolName == "generate" =>
                await GenerateImageAsync(GetArg(obj, "prompt"), GetArg(obj, "filename"), root, ct),
            "filesystem" => toolName switch
            {
                "read_file" => ReadFile(GetArg(obj, "path"), root),
                "list_directory" => ListDirectory(GetArg(obj, "path", "."), root),
                "list_tree" => ListTree(GetArg(obj, "path", "."), root),
                "write_file" => WriteFile(GetArg(obj, "path"), GetArg(obj, "content", ""), root),
                "replace_in_file" => ReplaceInFile(
                    GetArg(obj, "path"), GetArg(obj, "oldText"), GetArg(obj, "newText", ""), root),
                "create_directory" => CreateDirectory(GetArg(obj, "path"), root),
                "move_path" => MovePath(GetArg(obj, "source"), GetArg(obj, "destination"), root),
                "delete_path" => DeletePath(GetArg(obj, "path"), root),
                "create_zip" => CreateZip(GetArg(obj, "source"), GetArg(obj, "output"), root),
                "search_files" => SearchFiles(GetArg(obj, "query"), root),
                "search_content" => SearchContent(GetArg(obj, "query"), root),
                _ => throw new ArgumentException($"Unknown filesystem tool '{toolName}'")
            },
            _ => throw new ArgumentException($"Unknown builtin tool '{connectorName}.{toolName}'")
        };
    }

    // ---- filesystem ----

    private string ResolveSafe(string relativePath, string root)
    {
        if (string.IsNullOrWhiteSpace(relativePath)) relativePath = ".";
        // Models often prefix paths with a leading slash meaning "workspace root"
        // (e.g. "/generated/logo.png"); treat that as relative rather than rejecting it.
        relativePath = relativePath.TrimStart('/', '\\');
        if (Path.IsPathFullyQualified(relativePath))
            throw new UnauthorizedAccessException("Use a workspace-relative path.");
        var combined = Path.GetFullPath(Path.Combine(root, relativePath));
        // Path-traversal guard: the resolved path must stay inside the workspace root.
        if (!combined.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.Ordinal)
            && combined != root)
            throw new UnauthorizedAccessException($"Path '{relativePath}' escapes the workspace sandbox.");
        EnsureNoSymbolicLink(combined, root);
        return combined;
    }

    private JsonNode ReadFile(string path, string root)
    {
        var full = ResolveSafe(path, root);
        var info = new FileInfo(full);
        if (!info.Exists) throw new FileNotFoundException($"File not found: {path}");
        if (info.Length > MaxReadBytes)
            throw new InvalidOperationException($"File too large ({info.Length} bytes; limit {MaxReadBytes}).");
        var content = File.ReadAllText(full);
        return new JsonObject { ["path"] = path, ["content"] = Clamp(content) };
    }

    private JsonNode WriteFile(string path, string content, string root)
    {
        var full = ResolveSafe(path, root);
        Directory.CreateDirectory(Path.GetDirectoryName(full)!);
        File.WriteAllText(full, content);
        return new JsonObject { ["path"] = path, ["bytesWritten"] = Encoding.UTF8.GetByteCount(content) };
    }

    private JsonNode ReplaceInFile(string path, string oldText, string newText, string root)
    {
        if (oldText.Length == 0) throw new ArgumentException("oldText is required");
        var full = ResolveSafe(path, root);
        var content = File.ReadAllText(full);
        var first = content.IndexOf(oldText, StringComparison.Ordinal);
        if (first < 0) throw new InvalidOperationException("oldText was not found.");
        if (content.IndexOf(oldText, first + oldText.Length, StringComparison.Ordinal) >= 0)
            throw new InvalidOperationException("oldText occurs more than once; provide a larger unique block.");
        var updated = string.Concat(content.AsSpan(0, first), newText, content.AsSpan(first + oldText.Length));
        File.WriteAllText(full, updated);
        return new JsonObject { ["path"] = path, ["bytesWritten"] = Encoding.UTF8.GetByteCount(updated) };
    }

    private JsonNode ListDirectory(string path, string root)
    {
        var full = ResolveSafe(path, root);
        if (!Directory.Exists(full)) throw new DirectoryNotFoundException($"Directory not found: {path}");
        var entries = new JsonArray();
        foreach (var dir in Directory.GetDirectories(full).Take(200))
            entries.Add(new JsonObject { ["name"] = Path.GetFileName(dir), ["type"] = "dir" });
        foreach (var file in Directory.GetFiles(full).Take(500))
            entries.Add(new JsonObject { ["name"] = Path.GetFileName(file), ["type"] = "file", ["size"] = new FileInfo(file).Length });
        return new JsonObject { ["path"] = path, ["entries"] = entries };
    }

    private JsonNode ListTree(string path, string root)
    {
        var full = ResolveSafe(path, root);
        if (!Directory.Exists(full)) throw new DirectoryNotFoundException($"Directory not found: {path}");
        var entries = new JsonArray();
        foreach (var entry in Directory.EnumerateFileSystemEntries(full, "*", new EnumerationOptions
        {
            RecurseSubdirectories = true,
            IgnoreInaccessible = true,
            MaxRecursionDepth = 12,
            AttributesToSkip = FileAttributes.ReparsePoint
        }))
        {
            var relative = Path.GetRelativePath(root, entry);
            if (IsExcluded(relative)) continue;
            entries.Add(new JsonObject
            {
                ["path"] = relative,
                ["type"] = Directory.Exists(entry) ? "dir" : "file"
            });
            if (entries.Count >= 500) break;
        }
        return new JsonObject { ["path"] = path, ["entries"] = entries };
    }

    private JsonNode SearchFiles(string query, string root)
    {
        if (string.IsNullOrWhiteSpace(query)) throw new ArgumentException("query is required");
        var hits = new JsonArray();
        var count = 0;
        foreach (var file in Directory.EnumerateFiles(root, "*", new EnumerationOptions
        { RecurseSubdirectories = true, IgnoreInaccessible = true, MaxRecursionDepth = 12 }))
        {
            if (IsExcluded(Path.GetRelativePath(root, file))) continue;
            if (!Path.GetFileName(file).Contains(query, StringComparison.OrdinalIgnoreCase)) continue;
            hits.Add(Path.GetRelativePath(root, file));
            if (++count >= 100) break;
        }
        return new JsonObject { ["query"] = query, ["matches"] = hits };
    }

    private JsonNode SearchContent(string query, string root)
    {
        if (string.IsNullOrWhiteSpace(query)) throw new ArgumentException("query is required");
        var hits = new JsonArray();
        foreach (var file in Directory.EnumerateFiles(root, "*", new EnumerationOptions
        { RecurseSubdirectories = true, IgnoreInaccessible = true, MaxRecursionDepth = 12 }))
        {
            var relative = Path.GetRelativePath(root, file);
            if (IsExcluded(relative) || new FileInfo(file).Length > MaxReadBytes) continue;
            try
            {
                var lineNumber = 0;
                foreach (var line in File.ReadLines(file))
                {
                    lineNumber++;
                    if (!line.Contains(query, StringComparison.OrdinalIgnoreCase)) continue;
                    hits.Add(new JsonObject
                    {
                        ["path"] = relative,
                        ["line"] = lineNumber,
                        ["text"] = line.Length <= 300 ? line : line[..300]
                    });
                    if (hits.Count >= 100)
                        return new JsonObject { ["query"] = query, ["matches"] = hits };
                }
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }
        return new JsonObject { ["query"] = query, ["matches"] = hits };
    }

    private JsonNode CreateDirectory(string path, string root)
    {
        Directory.CreateDirectory(ResolveSafe(path, root));
        return new JsonObject { ["path"] = path, ["created"] = true };
    }

    private JsonNode MovePath(string source, string destination, string root)
    {
        var sourceFull = ResolveSafe(source, root);
        var destinationFull = ResolveSafe(destination, root);
        Directory.CreateDirectory(Path.GetDirectoryName(destinationFull)!);
        if (File.Exists(sourceFull)) File.Move(sourceFull, destinationFull);
        else if (Directory.Exists(sourceFull)) Directory.Move(sourceFull, destinationFull);
        else throw new FileNotFoundException($"Path not found: {source}");
        return new JsonObject { ["source"] = source, ["destination"] = destination };
    }

    private JsonNode DeletePath(string path, string root)
    {
        var full = ResolveSafe(path, root);
        if (File.Exists(full)) File.Delete(full);
        else if (Directory.Exists(full)) Directory.Delete(full, recursive: false);
        else throw new FileNotFoundException($"Path not found: {path}");
        return new JsonObject { ["path"] = path, ["deleted"] = true };
    }

    private JsonNode CreateZip(string source, string output, string root)
    {
        if (!output.EndsWith(".zip", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("output must end in .zip");
        var sourceFull = ResolveSafe(source, root);
        var outputFull = ResolveSafe(output, root);
        if (sourceFull == outputFull) throw new ArgumentException("source and output must differ");
        Directory.CreateDirectory(Path.GetDirectoryName(outputFull)!);
        if (File.Exists(outputFull)) File.Delete(outputFull);
        using var archive = ZipFile.Open(outputFull, ZipArchiveMode.Create);
        if (File.Exists(sourceFull))
        {
            archive.CreateEntryFromFile(sourceFull, Path.GetFileName(sourceFull), CompressionLevel.Optimal);
        }
        else if (Directory.Exists(sourceFull))
        {
            foreach (var file in Directory.EnumerateFiles(sourceFull, "*", SearchOption.AllDirectories))
            {
                if (file == outputFull) continue;
                var relative = Path.GetRelativePath(sourceFull, file);
                if (IsExcluded(relative)) continue;
                archive.CreateEntryFromFile(file, relative, CompressionLevel.Optimal);
            }
        }
        else throw new FileNotFoundException($"Path not found: {source}");
        return new JsonObject { ["source"] = source, ["output"] = output, ["bytes"] = new FileInfo(outputFull).Length };
    }

    // ---- image ----

    private async Task<JsonNode> GenerateImageAsync(string prompt, string filename, string root, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(prompt)) throw new ArgumentException("prompt is required");

        var sw = Stopwatch.StartNew();
        var (base64Png, modelUsed) = await FluxImageGenerator.GenerateWithFallbackAsync(
            FluxImageGenerator.PrimaryModel, FluxImageGenerator.FallbackModel, prompt, ct);
        sw.Stop();

        var bytes = Convert.FromBase64String(base64Png);
        var ext = FluxImageGenerator.DetectImageFormat(bytes)
            ?? throw new InvalidOperationException("Model produced an unrecognised image format.");

        var relativePath = Path.ChangeExtension(filename, ext);
        var full = ResolveSafe(relativePath, root);
        Directory.CreateDirectory(Path.GetDirectoryName(full)!);
        await File.WriteAllBytesAsync(full, bytes, ct);

        return new JsonObject
        {
            ["path"] = relativePath,
            ["model"] = modelUsed,
            ["bytesWritten"] = bytes.Length,
            ["generationMs"] = sw.ElapsedMilliseconds
        };
    }

    // ---- shell ----

    private async Task<JsonNode> RunShellAsync(string command, string root, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(command)) throw new ArgumentException("command is required");
        if (DangerousCommand().IsMatch(command))
            throw new UnauthorizedAccessException("Command blocked by the shell denylist.");

        var isWindows = OperatingSystem.IsWindows();
        var psi = new ProcessStartInfo
        {
            FileName = isWindows ? "cmd.exe" : "/bin/bash",
            Arguments = isWindows ? $"/c {command}" : $"-c \"{command.Replace("\"", "\\\"")}\"",
            WorkingDirectory = root,
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

    private async Task<JsonNode> SearchWebAsync(string query, CancellationToken ct)
    {
        using var request = CreateOllamaWebRequest("/api/web_search",
            new { query, max_results = 5 });
        using var response = await WebClient.SendAsync(request, ct);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<JsonNode>(cancellationToken: ct)
            ?? new JsonObject();
    }

    private async Task<JsonNode> FetchWebAsync(string url, CancellationToken ct)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) ||
            uri.Scheme is not ("http" or "https") ||
            await IsPrivateHostAsync(uri.Host, ct))
            throw new ArgumentException("url must be a public HTTP or HTTPS address");
        using var request = CreateOllamaWebRequest("/api/web_fetch", new { url });
        using var response = await WebClient.SendAsync(request, ct);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<JsonNode>(cancellationToken: ct)
            ?? new JsonObject();
    }

    private HttpRequestMessage CreateOllamaWebRequest(string path, object body)
    {
        if (string.IsNullOrWhiteSpace(_ollamaApiKey))
            throw new InvalidOperationException(
                "Web browsing requires EminentAi:OllamaApiKey or OLLAMA_API_KEY.");
        var request = new HttpRequestMessage(HttpMethod.Post, path)
        {
            Content = JsonContent.Create(body)
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _ollamaApiKey);
        return request;
    }

    /// <summary>
    /// Resolves the host to its actual IP address(es) and checks those against the private/
    /// reserved ranges (RFC1918, loopback, link-local incl. the 169.254.169.254 cloud metadata
    /// address, and IPv6 equivalents). Resolving before checking closes the DNS-rebinding gap in
    /// the previous string-prefix implementation, which also missed 127.0.0.0/8, 169.254.0.0/16,
    /// and ::1 entirely.
    /// </summary>
    private static async Task<bool> IsPrivateHostAsync(string host, CancellationToken ct)
    {
        if (host.Equals("localhost", StringComparison.OrdinalIgnoreCase)) return true;

        IPAddress[] addresses;
        if (IPAddress.TryParse(host, out var literal))
        {
            addresses = new[] { literal };
        }
        else
        {
            try
            {
                addresses = await Dns.GetHostAddressesAsync(host, ct);
            }
            catch
            {
                // Can't confirm the host is public — fail closed rather than allow an
                // unresolvable/ambiguous host through to an outbound fetch.
                return true;
            }
        }

        return addresses.Length == 0 || addresses.Any(IsPrivateOrReservedAddress);
    }

    private static bool IsPrivateOrReservedAddress(IPAddress address)
    {
        if (IPAddress.IsLoopback(address)) return true;

        var bytes = address.GetAddressBytes();
        if (address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork)
        {
            if (bytes[0] == 10) return true;                                  // 10.0.0.0/8
            if (bytes[0] == 172 && bytes[1] is >= 16 and <= 31) return true;   // 172.16.0.0/12
            if (bytes[0] == 192 && bytes[1] == 168) return true;               // 192.168.0.0/16
            if (bytes[0] == 169 && bytes[1] == 254) return true;               // 169.254.0.0/16 (incl. cloud metadata)
            if (bytes[0] == 127) return true;                                  // 127.0.0.0/8
            if (bytes[0] == 0) return true;                                    // 0.0.0.0/8
        }
        else if (address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetworkV6)
        {
            if ((bytes[0] & 0xfe) == 0xfc) return true;                        // fc00::/7 unique local
            if (bytes[0] == 0xfe && (bytes[1] & 0xc0) == 0x80) return true;    // fe80::/10 link-local
        }
        return false;
    }

    // ---- helpers ----

    private static string Clamp(string s) =>
        s.Length <= MaxOutputChars ? s : s[..MaxOutputChars] + $"… [truncated {s.Length - MaxOutputChars} chars]";

    private static string FindWorkspaceRoot()
    {
        var directory = new DirectoryInfo(Directory.GetCurrentDirectory());
        while (directory is not null)
        {
            if (Directory.Exists(Path.Combine(directory.FullName, ".git"))) return directory.FullName;
            directory = directory.Parent;
        }
        return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "EminentAiWorkspace");
    }

    private string ResolveWorkspaceRoot(string? requestedPath)
    {
        if (string.IsNullOrWhiteSpace(requestedPath)) return _workspaceRoot;
        if (!Path.IsPathFullyQualified(requestedPath))
            throw new ArgumentException("Workspace path must be absolute.", nameof(requestedPath));
        var full = Path.GetFullPath(requestedPath);
        if (File.Exists(full)) full = Path.GetDirectoryName(full)!;
        if (!Directory.Exists(full))
            throw new DirectoryNotFoundException($"Workspace path not found: {requestedPath}");
        var normalized = NormalizeExistingRoot(full);
        EnsureNotSensitiveRoot(normalized);
        return normalized;
    }

    private static string NormalizeExistingRoot(string path)
    {
        var full = Path.GetFullPath(path);
        var info = new DirectoryInfo(full);
        if (info.LinkTarget is not null)
            full = info.ResolveLinkTarget(returnFinalTarget: true)?.FullName
                ?? throw new UnauthorizedAccessException($"Unable to resolve workspace link '{path}'.");
        var filesystemRoot = Path.GetPathRoot(full);
        return full == filesystemRoot ? full : full.TrimEnd(Path.DirectorySeparatorChar);
    }

    private static void EnsureNoSymbolicLink(string target, string root)
    {
        var relative = Path.GetRelativePath(root, target);
        if (relative == ".") return;
        var current = root;
        foreach (var segment in relative.Split(
                     new[] { Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar },
                     StringSplitOptions.RemoveEmptyEntries))
        {
            current = Path.Combine(current, segment);
            FileSystemInfo info = Directory.Exists(current)
                ? new DirectoryInfo(current)
                : new FileInfo(current);
            if (info.LinkTarget is not null)
                throw new UnauthorizedAccessException(
                    $"Path '{relative}' contains a symbolic link and cannot be accessed.");
        }
    }

    /// <summary>
    /// Blocks pointing the workspace root (and therefore every read_file/list_directory/
    /// search_content/search_files/list_tree call, none of which require approval) at a
    /// filesystem root or a well-known credential directory. This is a floor, not a full
    /// sandbox — a user can still nest an arbitrary path under their home directory — but it
    /// stops the single-click "/", "~", or "~/.ssh" case that currently sails through with
    /// zero approval prompt.
    /// </summary>
    private static void EnsureNotSensitiveRoot(string normalized)
    {
        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        var candidates = new[]
        {
            Path.GetPathRoot(normalized),
            home,
            string.IsNullOrEmpty(home) ? null : Path.Combine(home, ".ssh"),
            string.IsNullOrEmpty(home) ? null : Path.Combine(home, ".aws"),
            string.IsNullOrEmpty(home) ? null : Path.Combine(home, ".gnupg"),
            string.IsNullOrEmpty(home) ? null : Path.Combine(home, "Library", "Keychains"),
            string.IsNullOrEmpty(home) ? null : Path.Combine(home, "Library", "Application Support"),
            string.IsNullOrEmpty(home) ? null : Path.Combine(home, "AppData"),
        };

        foreach (var blocked in candidates)
        {
            if (string.IsNullOrEmpty(blocked)) continue;
            var normalizedBlocked = blocked.TrimEnd(Path.DirectorySeparatorChar);
            if (string.Equals(normalized, normalizedBlocked, StringComparison.OrdinalIgnoreCase))
                throw new UnauthorizedAccessException(
                    $"Workspace root '{normalized}' is a filesystem root or well-known sensitive " +
                    "directory and cannot be used directly. Point the workspace at a specific project subdirectory instead.");
        }
    }

    private static bool IsExcluded(string relativePath)
    {
        var segments = relativePath.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        return segments.Any(segment =>
            segment is ".git" or "node_modules" or "bin" or "obj" or ".next" or "dist");
    }

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
