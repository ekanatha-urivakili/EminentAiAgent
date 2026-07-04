using System.Diagnostics;
using System.Runtime.InteropServices;
using EminentAi.Api.JobSearch;
using EminentAi.Application.Abstractions;
using Microsoft.EntityFrameworkCore;
using EminentAi.Infrastructure.Persistence;

namespace EminentAi.Api.Observability;

public sealed class ObservabilityService(
    IOllamaClient ollama,
    JobSearchOrchestrator jobSearch,
    JobRunCache jobCache,
    IDbContextFactory<EminentAiDbContext> dbFactory)
{
    public async Task<ObservabilityData> GetDataAsync(CancellationToken ct)
    {
        var ollamaOk = await ollama.IsHealthyAsync(ct);
        var loadedModels = ollamaOk ? await ollama.GetLoadedModelsAsync(ct) : Array.Empty<LoadedModelInfo>();
        var systemMetrics = GetSystemMetrics();
        var jobSearchHealth = await GetJobSearchHealthAsync(ct);

        return new ObservabilityData(systemMetrics, loadedModels, jobSearchHealth, ollamaOk);
    }

    private SystemMetrics GetSystemMetrics()
    {
        double cpu = 0;
        long memUsed = 0;
        long memTotal = 0;
        long diskUsed = 0;
        long diskTotal = 0;

        if (RuntimeInformation.IsOSPlatform(OSPlatform.OSX))
        {
            try
            {
                // Simple but potentially slow; in a real app we'd cache this or use a more efficient way
                var top = RunCommand("top", "-l 1 -n 0");
                var cpuMatch = System.Text.RegularExpressions.Regex.Match(top, @"CPU usage: ([\d.]+)% user, ([\d.]+)% sys");
                if (cpuMatch.Success)
                {
                    cpu = double.Parse(cpuMatch.Groups[1].Value) + double.Parse(cpuMatch.Groups[2].Value);
                }

                var memMatch = System.Text.RegularExpressions.Regex.Match(top, @"PhysMem: ([\d\w.]+) used \(.*?\), ([\d\w.]+) unused");
                if (memMatch.Success)
                {
                    memUsed = ParseMem(memMatch.Groups[1].Value);
                    var unused = ParseMem(memMatch.Groups[2].Value);
                    memTotal = memUsed + unused;
                }
            }
            catch { /* fallback or ignore */ }
        }

        try
        {
            var drive = DriveInfo.GetDrives().FirstOrDefault(d => d.IsReady);
            if (drive != null)
            {
                diskTotal = drive.TotalSize;
                diskUsed = drive.TotalSize - drive.AvailableFreeSpace;
            }
        }
        catch { }

        return new SystemMetrics(cpu, memUsed, memTotal, diskUsed, diskTotal, GetGpuMetrics());
    }

    private GpuMetrics? GetGpuMetrics()
    {
        if (RuntimeInformation.IsOSPlatform(OSPlatform.OSX))
        {
            // On Apple Silicon, GPU memory is shared with System RAM.
            // We can try to get some info via system_profiler
            try
            {
                var profiler = RunCommand("system_profiler", "SPDisplaysDataType");
                if (profiler.Contains("Apple M"))
                {
                    return new GpuMetrics("Apple Silicon GPU (Unified)", 0, 0, 0); // Usage/Mem is tricky without sudo/powermetrics
                }
            }
            catch { }
        }
        return null;
    }

    private async Task<JobSearchHealth> GetJobSearchHealthAsync(CancellationToken ct)
    {
        // Load criteria from DB
        JobSearchCriteria criteria = new();
        await using (var db = await dbFactory.CreateDbContextAsync(ct))
        {
             var rows = await db.Database.SqlQuery<AppSettingRow>(
                $"""SELECT "Key", "Value" FROM "AppSettings" WHERE "Key" = 'job_search_criteria'""").ToListAsync(ct);
            if (rows.FirstOrDefault() is { Value: var json })
            {
                try { criteria = System.Text.Json.JsonSerializer.Deserialize<JobSearchCriteria>(json, new System.Text.Json.JsonSerializerOptions { PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase }) ?? new(); }
                catch { }
            }
        }

        var healths = jobSearch.GetSourceHealth(criteria);
        var issues = healths
            .Where(h => !h.Ready || !string.IsNullOrEmpty(h.LastError))
            .Select(h => new SourceIssue(h.Source, h.LastError ?? "Missing configuration"))
            .ToList();

        var latest = jobCache.LatestRun;

        return new JobSearchHealth(
            issues.Count == 0,
            issues,
            latest?.FinishedAt,
            latest?.Matches.Count ?? 0
        );
    }

    private static string RunCommand(string bin, string args)
    {
        using var p = Process.Start(new ProcessStartInfo
        {
            FileName = bin,
            Arguments = args,
            RedirectStandardOutput = true,
            UseShellExecute = false,
            CreateNoWindow = true
        });
        return p?.StandardOutput.ReadToEnd() ?? "";
    }

    private static long ParseMem(string val)
    {
        val = val.ToUpperInvariant();
        if (val.EndsWith("G")) return (long)(double.Parse(val.TrimEnd('G')) * 1024 * 1024 * 1024);
        if (val.EndsWith("M")) return (long)(double.Parse(val.TrimEnd('M')) * 1024 * 1024);
        if (val.EndsWith("K")) return (long)(double.Parse(val.TrimEnd('K')) * 1024);
        if (long.TryParse(val, out var l)) return l;
        return 0;
    }

    private class AppSettingRow
    {
        public string Key { get; set; } = "";
        public string Value { get; set; } = "";
    }
}
