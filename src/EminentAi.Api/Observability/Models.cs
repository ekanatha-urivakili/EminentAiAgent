using EminentAi.Application.Abstractions;

namespace EminentAi.Api.Observability;

public record SystemMetrics(
    double CpuUsagePercent,
    long MemoryUsedBytes,
    long MemoryTotalBytes,
    long DiskUsedBytes,
    long DiskTotalBytes,
    GpuMetrics? Gpu = null
);

public record GpuMetrics(
    string Name,
    double UsagePercent,
    long MemoryUsedBytes,
    long MemoryTotalBytes
);

public record ObservabilityData(
    SystemMetrics System,
    IReadOnlyList<LoadedModelInfo> LoadedModels,
    JobSearchHealth JobSearch,
    bool OllamaOk
);

public record JobSearchHealth(
    bool AllSourcesHealthy,
    IReadOnlyList<SourceIssue> Issues,
    DateTime? LastRunAt,
    int LastRunMatches
);

public record SourceIssue(
    string Source,
    string Error
);
