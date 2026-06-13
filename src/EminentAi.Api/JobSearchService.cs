using System.Collections.Concurrent;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace EminentAi.Api.JobSearch;

// ── Data contracts ─────────────────────────────────────────────────────────

public sealed record JobSearchCriteria
{
    public string TimeZone { get; init; } = "Europe/London";
    public string RunAt { get; init; } = "10:00";
    public List<string> Keywords { get; init; } = new();
    public List<string> DesiredDesignations { get; init; } = new()
    {
        "Senior Software Engineer",
        "Lead Developer",
        "Principal Engineer",
        "Senior Fullstack Engineer",
        "Senior Software Developer",
        "Lead Software Engineer",
        "Principal Developer",
    };
    public List<string> Skills { get; init; } = new()
    {
        "c#",
        "asp.net core",
        "web api",
        "react",
        "typescript",
        "javascript",
        "aws",
        "docker",
        "sql server",
        "postgresql",
        "microservices",
        "cqrs",
        "rest",
    };
    public List<string> ExcludedKeywords { get; init; } = new()
    {
        "graduate",
        "junior",
        "java only",
        "onsite 5 days",
        "5 days onsite",
        "sc clearance",
    };
    public string Postcode { get; init; } = string.Empty;
    public int RadiusMiles { get; init; } = 30;
    public int PostedWithinDays { get; init; } = 7;
    public List<string> EmploymentTypes { get; init; } = new() { "Permanent", "Contract" };
    public List<string> WorkModes { get; init; } = new() { "Remote", "Hybrid", "Office" };
    public decimal MinimumPermanentSalaryGbp { get; init; } = 0;
    public decimal MinimumContractDayRateGbp { get; init; } = 0;
    public int MinimumContractMonths { get; init; } = 0;
    public string? ReedApiKey { get; init; }
    public string? SlackWebhookUrl { get; init; }
    public string? GmailCredentialsJson { get; init; }
    public string? GmailUserEmail { get; init; }
    public string? GmailSearchQuery { get; init; } = "label:job-alerts is:unread";
    public List<string> ConfiguredSecretKeys { get; init; } = new();
}

public sealed record NormalizedJob
{
    public string Id { get; init; } = Guid.NewGuid().ToString();
    public string Source { get; init; } = string.Empty;
    public string SourceJobId { get; init; } = string.Empty;
    public string Title { get; init; } = string.Empty;
    public string Company { get; init; } = string.Empty;
    public string Location { get; init; } = string.Empty;
    public string? Url { get; init; }
    public string? EmploymentType { get; init; }
    public string? WorkMode { get; init; }
    public decimal? SalaryMin { get; init; }
    public decimal? SalaryMax { get; init; }
    public decimal? DayRateMin { get; init; }
    public decimal? DayRateMax { get; init; }
    public int? ContractMonths { get; init; }
    public DateTime? PostedDate { get; init; }
    public string? Description { get; init; }
}

public sealed record JobMatchResult
{
    public NormalizedJob Posting { get; init; } = new();
    public int Score { get; init; }
    public bool Recommended { get; init; }
    public List<string> Reasons { get; init; } = new();
    public List<string> Risks { get; init; } = new();
}

public sealed record SourceStatus
{
    public string Source { get; init; } = string.Empty;
    public string Status { get; init; } = string.Empty;
    public int JobsFetched { get; init; }
    public string Mode { get; init; } = string.Empty;
    public string? Error { get; init; }
}

public sealed record SourceHealthInfo
{
    public string Source { get; init; } = string.Empty;
    public string Mode { get; init; } = string.Empty;
    public bool Ready { get; init; }
    public string? RequiredSecret { get; init; }
    public string? LastError { get; init; }
    public int BufferedJobs { get; init; }
}

public sealed record JobSearchRunResult
{
    public string RunId { get; init; } = Guid.NewGuid().ToString();
    public DateTime StartedAt { get; init; } = DateTime.UtcNow;
    public DateTime? FinishedAt { get; init; }
    public string Status { get; init; } = "Completed";
    public List<SourceStatus> SourceStatuses { get; init; } = new();
    public List<JobMatchResult> Matches { get; init; } = new();
    public Dictionary<string, int> RejectedSummary { get; init; } = new();
    public string? ReportMarkdown { get; init; }
}

public sealed record IndeedJobInput
{
    public string JobId { get; init; } = string.Empty;
    [JsonPropertyName("jobkey")]
    public string? JobKey { get; init; }
    [JsonPropertyName("jk")]
    public string? Jk { get; init; }
    public string Title { get; init; } = string.Empty;
    public string? JobTitle { get; init; }
    public string Company { get; init; } = string.Empty;
    public string? CompanyName { get; init; }
    public string Location { get; init; } = string.Empty;
    public string? FormattedLocation { get; init; }
    public string? Url { get; init; }
    public string? JobUrl { get; init; }
    public string? EmploymentType { get; init; }
    public string? WorkMode { get; init; }
    public decimal? SalaryMin { get; init; }
    public decimal? SalaryMax { get; init; }
    public decimal? DayRateMin { get; init; }
    public decimal? DayRateMax { get; init; }
    public int? ContractMonths { get; init; }
    public string? Description { get; init; }
    public string? JobDescription { get; init; }
    public string? Snippet { get; init; }
}

public sealed record IngestIndeedRequest(bool ClearFirst, List<IndeedJobInput> Jobs);

// ── Indeed Direct Buffer ─────────────────────────────────────────────────────

public sealed class IndeedDirectBuffer
{
    private readonly ConcurrentDictionary<string, NormalizedJob> _jobs = new();

    public void Ingest(IEnumerable<IndeedJobInput> inputs, bool clearFirst)
    {
        if (clearFirst) _jobs.Clear();
        foreach (var input in inputs)
        {
            var jobId = FirstValue(input.JobId, input.JobKey, input.Jk, StableId(input));
            var title = FirstValue(input.Title, input.JobTitle);
            var company = FirstValue(input.Company, input.CompanyName);
            var location = FirstValue(input.Location, input.FormattedLocation, "Remote");
            var employmentType = FirstValue(input.EmploymentType, InferEmploymentType(input));
            var workMode = FirstValue(input.WorkMode, InferWorkMode(location, input.Description, input.JobDescription, input.Snippet));

            if (string.IsNullOrWhiteSpace(title) || string.IsNullOrWhiteSpace(company))
                continue;

            _jobs[jobId] = new NormalizedJob
            {
                Source = "Indeed Direct",
                SourceJobId = jobId,
                Title = title,
                Company = company,
                Location = location,
                Url = FirstValue(input.Url, input.JobUrl, $"https://uk.indeed.com/viewjob?jk={Uri.EscapeDataString(jobId)}"),
                EmploymentType = employmentType,
                WorkMode = workMode,
                SalaryMin = input.SalaryMin,
                SalaryMax = input.SalaryMax,
                DayRateMin = input.DayRateMin,
                DayRateMax = input.DayRateMax,
                ContractMonths = input.ContractMonths,
                Description = FirstValue(input.Description, input.JobDescription, input.Snippet),
                PostedDate = DateTime.UtcNow,
            };
        }
    }

    public IReadOnlyCollection<NormalizedJob> GetAll() => (IReadOnlyCollection<NormalizedJob>)_jobs.Values;
    public int Count => _jobs.Count;

    private static string FirstValue(params string?[] values) =>
        values.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value))?.Trim() ?? string.Empty;

    private static string StableId(IndeedJobInput input)
    {
        var raw = $"{input.Title}|{input.JobTitle}|{input.Company}|{input.CompanyName}|{input.Location}|{input.FormattedLocation}";
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(raw));
        return Convert.ToHexString(bytes)[..16].ToLowerInvariant();
    }

    private static string InferEmploymentType(IndeedJobInput input)
    {
        var text = $"{input.Title} {input.JobTitle} {input.Description} {input.JobDescription} {input.Snippet}".ToLowerInvariant();
        return text.Contains("contract") || text.Contains("outside ir35") || text.Contains("inside ir35")
            ? "Contract"
            : "Permanent";
    }

    private static string InferWorkMode(params string?[] values)
    {
        var text = string.Join(' ', values.Where(value => !string.IsNullOrWhiteSpace(value))).ToLowerInvariant();
        if (text.Contains("remote")) return "Remote";
        if (text.Contains("hybrid")) return "Hybrid";
        return "Office";
    }
}

// ── Latest Run Cache ──────────────────────────────────────────────────────────

public sealed class JobRunCache
{
    public JobSearchRunResult? LatestRun { get; set; }
}

// ── Reed API response shapes ──────────────────────────────────────────────────

internal sealed class ReedSearchResponse
{
    [JsonPropertyName("results")]
    public List<ReedJobResult> Results { get; set; } = new();
    [JsonPropertyName("totalResults")]
    public int TotalResults { get; set; }
}

internal sealed class ReedJobResult
{
    [JsonPropertyName("jobId")]
    public long JobId { get; set; }
    [JsonPropertyName("jobTitle")]
    public string JobTitle { get; set; } = string.Empty;
    [JsonPropertyName("employerName")]
    public string EmployerName { get; set; } = string.Empty;
    [JsonPropertyName("locationName")]
    public string LocationName { get; set; } = string.Empty;
    [JsonPropertyName("minimumSalary")]
    public decimal? MinimumSalary { get; set; }
    [JsonPropertyName("maximumSalary")]
    public decimal? MaximumSalary { get; set; }
    [JsonPropertyName("salaryType")]
    public string? SalaryType { get; set; }
    [JsonPropertyName("jobDescription")]
    public string? JobDescription { get; set; }
    [JsonPropertyName("jobUrl")]
    public string? JobUrl { get; set; }
    [JsonPropertyName("datePosted")]
    public DateTime? DatePosted { get; set; }
    [JsonPropertyName("contractType")]
    public string? ContractType { get; set; }
    [JsonPropertyName("partTime")]
    public bool PartTime { get; set; }
    [JsonPropertyName("fullTime")]
    public bool FullTime { get; set; }
}

// ── Reed Adapter ──────────────────────────────────────────────────────────────

public static class ReedAdapter
{
    public static async Task<(List<NormalizedJob> Jobs, string? Error)> FetchAsync(
        HttpClient client, JobSearchCriteria criteria, CancellationToken ct)
    {
        try
        {
            var keywords = string.Join(" ", EffectiveKeywords(criteria));
            var qs = new StringBuilder("/1.0/search?resultsToTake=50");
            if (!string.IsNullOrWhiteSpace(keywords))
                qs.Append($"&keywords={Uri.EscapeDataString(keywords)}");
            if (!string.IsNullOrWhiteSpace(criteria.Postcode))
            {
                qs.Append($"&locationName={Uri.EscapeDataString(criteria.Postcode)}");
                qs.Append($"&distanceFromLocation={criteria.RadiusMiles}");
            }

            var response = await client.GetAsync(qs.ToString(), ct);
            if (!response.IsSuccessStatusCode)
                return (new(), $"Reed API returned {(int)response.StatusCode}");

            var body = await response.Content.ReadAsStringAsync(ct);
            var parsed = JsonSerializer.Deserialize<ReedSearchResponse>(body,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true });

            if (parsed?.Results is null) return (new(), null);

            var jobs = parsed.Results.Select(r => MapReedJob(r)).ToList();
            return (jobs, null);
        }
        catch (Exception ex)
        {
            return (new(), ex.Message);
        }
    }

    private static NormalizedJob MapReedJob(ReedJobResult r)
    {
        var isPerDay = r.SalaryType?.Contains("day", StringComparison.OrdinalIgnoreCase) == true;
        var empType = r.ContractType ?? (r.PartTime ? "Part-time" : "Permanent");

        return new NormalizedJob
        {
            Source = "Reed",
            SourceJobId = r.JobId.ToString(),
            Title = r.JobTitle,
            Company = r.EmployerName,
            Location = r.LocationName,
            Url = r.JobUrl,
            EmploymentType = empType,
            SalaryMin = isPerDay ? null : r.MinimumSalary,
            SalaryMax = isPerDay ? null : r.MaximumSalary,
            DayRateMin = isPerDay ? r.MinimumSalary : null,
            DayRateMax = isPerDay ? r.MaximumSalary : null,
            PostedDate = r.DatePosted,
            Description = r.JobDescription,
        };
    }

    private static IReadOnlyCollection<string> EffectiveKeywords(JobSearchCriteria criteria) =>
        criteria.Keywords.Count > 0 ? criteria.Keywords : criteria.DesiredDesignations;
}

// ── Job Filter ─────────────────────────────────────────────────────────────────

public static class JobFilter
{
    public static (bool Pass, string? RejectReason) Evaluate(NormalizedJob job, JobSearchCriteria criteria)
    {
        var jobText = $"{job.Title} {job.Company} {job.Location} {job.Description ?? ""}";
        var jobTextLower = jobText.ToLowerInvariant();

        if (criteria.ExcludedKeywords.Any(k => !string.IsNullOrWhiteSpace(k) && jobTextLower.Contains(k.ToLowerInvariant())))
            return (false, "Excluded keyword");

        if (job.PostedDate.HasValue)
        {
            var ageDays = (DateTime.UtcNow - job.PostedDate.Value).TotalDays;
            if (ageDays > criteria.PostedWithinDays)
                return (false, "Stale posting");
        }

        var keywords = criteria.Keywords.Count > 0 ? criteria.Keywords : criteria.DesiredDesignations;
        if (keywords.Count > 0)
        {
            var titleLower = job.Title.ToLowerInvariant();
            var descLower = (job.Description ?? "").ToLowerInvariant();
            var hasMatch = keywords.Any(k =>
                titleLower.Contains(k.ToLowerInvariant()) ||
                descLower.Contains(k.ToLowerInvariant()));
            if (!hasMatch)
                return (false, "Title mismatch");
        }

        var empType = (job.EmploymentType ?? "").ToLowerInvariant();
        if (criteria.EmploymentTypes.Count > 0 &&
            !criteria.EmploymentTypes.Any(type => empType.Contains(type.ToLowerInvariant())))
            return (false, "Employment type mismatch");

        var workMode = (job.WorkMode ?? "").ToLowerInvariant();
        if (criteria.WorkModes.Count > 0 &&
            !string.IsNullOrWhiteSpace(workMode) &&
            !criteria.WorkModes.Any(mode => workMode.Contains(mode.ToLowerInvariant())))
            return (false, "Work mode mismatch");

        if (empType.Contains("contract"))
        {
            if (criteria.MinimumContractDayRateGbp > 0 &&
                job.DayRateMax.HasValue &&
                job.DayRateMax < criteria.MinimumContractDayRateGbp)
                return (false, "Day rate below threshold");

            if (criteria.MinimumContractMonths > 0 &&
                job.ContractMonths.HasValue &&
                job.ContractMonths < criteria.MinimumContractMonths)
                return (false, "Contract too short");
        }
        else
        {
            // Permanent/default: reject only when salary is published AND below threshold
            if (criteria.MinimumPermanentSalaryGbp > 0 &&
                job.SalaryMax.HasValue &&
                job.SalaryMax < criteria.MinimumPermanentSalaryGbp)
                return (false, "Below salary threshold");
        }

        return (true, null);
    }
}

// ── Job Scorer ─────────────────────────────────────────────────────────────────

public static class JobScorer
{
    private static readonly HashSet<string> StopWords = new(StringComparer.OrdinalIgnoreCase)
    {
        "the","and","for","with","that","this","will","have","from","your","you","our",
        "we","are","is","in","of","to","a","an","be","has","at","by","on","or","as",
        "it","its","not","was","can","do","all","any","but","more","their","they","been",
        "also","into","which","who","job","role","work","team","skills","experience",
        "working","including","required","ability","knowledge","strong","excellent","good",
        "great","looking","seeking","candidate","applicant","must","should","would",
    };

    public static HashSet<string> ExtractKeywords(string text)
    {
        return Regex.Split(text, @"\W+")
            .Where(w => w.Length > 3 && !StopWords.Contains(w))
            .Select(w => w.ToLowerInvariant())
            .ToHashSet();
    }

    public static (int Score, bool Recommended, List<string> Reasons, List<string> Risks) Score(
        NormalizedJob job, HashSet<string> cvKeywords, JobSearchCriteria criteria)
    {
        var reasons = new List<string>();
        var risks = new List<string>();

        var jobText = $"{job.Title} {job.Description ?? ""}";
        var jobKeywords = ExtractKeywords(jobText);

        int matchCount = jobKeywords.Count == 0 ? 0 : jobKeywords.Intersect(cvKeywords).Count();
        int baseScore = jobKeywords.Count == 0
            ? 50
            : Math.Min(88, matchCount * 100 / Math.Max(jobKeywords.Count, 1));

        // Title-specific keyword match bonus
        var titleKeywords = ExtractKeywords(job.Title);
        var profileKeywords = criteria.Keywords.Count > 0
            ? criteria.Keywords
            : criteria.DesiredDesignations.Concat(criteria.Skills).ToList();
        if (profileKeywords.Count > 0)
        {
            var criteriaKeywords = profileKeywords.Select(k => k.ToLowerInvariant()).ToHashSet();
            var titleCriteriaMatch = titleKeywords
                .Any(tk => criteriaKeywords.Any(ck => tk.Contains(ck) || ck.Contains(tk)));
            if (titleCriteriaMatch)
            {
                baseScore = Math.Min(100, baseScore + 15);
                reasons.Add("Strong title match");
            }
        }

        if (job.SalaryMin.HasValue || job.DayRateMin.HasValue)
        {
            baseScore = Math.Min(100, baseScore + 5);
            reasons.Add("Salary/rate visible");
        }

        if (matchCount > 15) reasons.Add("High keyword overlap with CV");
        else if (matchCount > 7) reasons.Add("Moderate keyword overlap with CV");

        if (!job.SalaryMin.HasValue && !job.DayRateMin.HasValue)
            risks.Add("Salary/rate not published");

        if (string.IsNullOrWhiteSpace(job.WorkMode))
            risks.Add("Work mode unspecified");

        bool recommended = baseScore >= 55 && reasons.Count >= 1;

        return (Math.Max(0, baseScore), recommended, reasons, risks);
    }
}

// ── CV Loader ─────────────────────────────────────────────────────────────────

public static class CvLoader
{
    public static HashSet<string> LoadKeywords(string cvFolder)
    {
        if (!Directory.Exists(cvFolder)) return new();

        var allText = new StringBuilder();
        foreach (var file in Directory.EnumerateFiles(cvFolder, "*.*")
            .Where(f => f.EndsWith(".txt", StringComparison.OrdinalIgnoreCase) ||
                        f.EndsWith(".md", StringComparison.OrdinalIgnoreCase)))
        {
            try { allText.AppendLine(File.ReadAllText(file)); }
            catch { /* skip unreadable files */ }
        }

        return JobScorer.ExtractKeywords(allText.ToString());
    }

    public static string[] ListFiles(string cvFolder)
    {
        if (!Directory.Exists(cvFolder)) return Array.Empty<string>();
        return Directory.EnumerateFiles(cvFolder)
            .Select(Path.GetFileName)
            .Where(n => n is not null)
            .Select(n => n!)
            .OrderBy(n => n)
            .ToArray();
    }
}

// ── Report Generator ──────────────────────────────────────────────────────────

public static class ReportGenerator
{
    public static string Generate(JobSearchRunResult result)
    {
        var sb = new StringBuilder();
        sb.AppendLine($"# Job Search Report — {result.StartedAt:yyyy-MM-dd HH:mm} UTC");
        sb.AppendLine();
        sb.AppendLine("## Source Status");
        foreach (var s in result.SourceStatuses)
            sb.AppendLine($"- **{s.Source}** ({s.Mode}): {s.Status} — {s.JobsFetched} fetched");

        sb.AppendLine();
        var recommended = result.Matches.Count(m => m.Recommended);
        sb.AppendLine($"## Results: {result.Matches.Count} matches ({recommended} recommended)");
        sb.AppendLine();

        foreach (var m in result.Matches.OrderByDescending(x => x.Score))
        {
            sb.AppendLine($"### [{m.Posting.Title}]({m.Posting.Url ?? "#"}) — {m.Posting.Company}");
            sb.AppendLine($"**Score:** {m.Score}/100 | **{(m.Recommended ? "✓ Recommended" : "—")}** | {m.Posting.Location}");
            if (m.Posting.SalaryMin.HasValue)
                sb.AppendLine($"**Salary:** £{m.Posting.SalaryMin:N0}–£{m.Posting.SalaryMax:N0}");
            if (m.Posting.DayRateMin.HasValue)
                sb.AppendLine($"**Day Rate:** £{m.Posting.DayRateMin:N0}–£{m.Posting.DayRateMax:N0}");
            if (m.Reasons.Count > 0)
                sb.AppendLine($"**Reasons:** {string.Join(", ", m.Reasons)}");
            if (m.Risks.Count > 0)
                sb.AppendLine($"**Risks:** {string.Join(", ", m.Risks)}");
            sb.AppendLine();
        }

        if (result.RejectedSummary.Count > 0)
        {
            sb.AppendLine("## Rejected Jobs Summary");
            foreach (var (reason, count) in result.RejectedSummary.OrderByDescending(kv => kv.Value))
                sb.AppendLine($"- {reason}: {count}");
        }

        return sb.ToString();
    }
}

// ── Job Search Orchestrator ───────────────────────────────────────────────────

public sealed class JobSearchOrchestrator
{
    private readonly IHttpClientFactory _httpFactory;
    private readonly IndeedDirectBuffer _indeedBuffer;
    private readonly JobRunCache _runCache;
    private readonly string _cvFolder;

    public JobSearchOrchestrator(
        IHttpClientFactory httpFactory,
        IndeedDirectBuffer indeedBuffer,
        JobRunCache runCache,
        IConfiguration config)
    {
        _httpFactory = httpFactory;
        _indeedBuffer = indeedBuffer;
        _runCache = runCache;
        _cvFolder = config["EminentAi:CvFolder"] ?? Path.Combine(Directory.GetCurrentDirectory(), "CVs");
    }

    public string CvFolder => _cvFolder;

    public async Task<JobSearchRunResult> RunSearchAsync(JobSearchCriteria criteria, CancellationToken ct)
    {
        var runId = Guid.NewGuid().ToString();
        var startedAt = DateTime.UtcNow;
        var allJobs = new List<NormalizedJob>();
        var sourceStatuses = new List<SourceStatus>();
        var rejectedSummary = new Dictionary<string, int>();

        // Reed API
        var reedApiKey = FirstValue(criteria.ReedApiKey, Environment.GetEnvironmentVariable("REED_API_KEY"));
        if (!string.IsNullOrWhiteSpace(reedApiKey))
        {
            var reedClient = _httpFactory.CreateClient("ReedApi");
            var authValue = Convert.ToBase64String(Encoding.ASCII.GetBytes($"{reedApiKey}:"));
            reedClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Basic", authValue);

            var (reedJobs, reedError) = await ReedAdapter.FetchAsync(reedClient, criteria, ct);
            allJobs.AddRange(reedJobs);
            sourceStatuses.Add(new SourceStatus
            {
                Source = "Reed",
                Mode = "ApprovedApi",
                Status = reedError is null ? "Succeeded" : "Failed",
                JobsFetched = reedJobs.Count,
                Error = reedError,
            });
        }
        else
        {
            sourceStatuses.Add(new SourceStatus
            {
                Source = "Reed",
                Mode = "ApprovedApi",
                Status = "NotConfigured",
                JobsFetched = 0,
                Error = "REED_API_KEY not set",
            });
        }

        sourceStatuses.Add(new SourceStatus
        {
            Source = "Gmail Alerts",
            Mode = "AlertInbox",
            Status = !string.IsNullOrWhiteSpace(criteria.GmailCredentialsJson) &&
                     !string.IsNullOrWhiteSpace(criteria.GmailUserEmail)
                ? "NotImplemented"
                : "NotConfigured",
            JobsFetched = 0,
            Error = "Gmail alert fetching needs the Gmail API adapter package before it can run inside EminentAi.",
        });

        // Indeed Direct buffer
        var indeedJobs = _indeedBuffer.GetAll().ToList();
        allJobs.AddRange(indeedJobs);
        sourceStatuses.Add(new SourceStatus
        {
            Source = "Indeed Direct",
            Mode = "McpPlugin",
            Status = indeedJobs.Count > 0 ? "Succeeded" : "Empty",
            JobsFetched = indeedJobs.Count,
        });

        // Deduplicate by Source+SourceJobId
        var seen = new HashSet<string>();
        var deduped = new List<NormalizedJob>();
        foreach (var job in allJobs)
        {
            var key = $"{job.Source}|{job.SourceJobId}";
            if (seen.Add(key)) deduped.Add(job);
        }

        // Load CV keywords for scoring
        var cvKeywords = CvLoader.LoadKeywords(_cvFolder);
        cvKeywords.UnionWith(criteria.Skills.SelectMany(JobScorer.ExtractKeywords));

        // Filter + Score
        var matches = new List<JobMatchResult>();
        foreach (var job in deduped)
        {
            var (pass, rejectReason) = JobFilter.Evaluate(job, criteria);
            if (!pass)
            {
                var reason = rejectReason ?? "Other";
                rejectedSummary[reason] = rejectedSummary.GetValueOrDefault(reason) + 1;
                continue;
            }

            var (score, recommended, reasons, risks) = JobScorer.Score(job, cvKeywords, criteria);
            matches.Add(new JobMatchResult
            {
                Posting = job,
                Score = score,
                Recommended = recommended,
                Reasons = reasons,
                Risks = risks,
            });
        }

        var result = new JobSearchRunResult
        {
            RunId = runId,
            StartedAt = startedAt,
            FinishedAt = DateTime.UtcNow,
            Status = "Completed",
            SourceStatuses = sourceStatuses,
            Matches = matches.OrderByDescending(m => m.Score).ToList(),
            RejectedSummary = rejectedSummary,
            ReportMarkdown = null, // filled below
        };

        var report = ReportGenerator.Generate(result);
        result = result with { ReportMarkdown = report };

        _runCache.LatestRun = result;
        return result;
    }

    public IReadOnlyList<SourceHealthInfo> GetSourceHealth(JobSearchCriteria criteria)
    {
        var reedApiKey = FirstValue(criteria.ReedApiKey, Environment.GetEnvironmentVariable("REED_API_KEY"));
        var gmailConfigured =
            !string.IsNullOrWhiteSpace(criteria.GmailCredentialsJson) &&
            !string.IsNullOrWhiteSpace(criteria.GmailUserEmail);
        return new[]
        {
            new SourceHealthInfo
            {
                Source = "Reed",
                Mode = "ApprovedApi",
                Ready = !string.IsNullOrWhiteSpace(reedApiKey),
                RequiredSecret = "REED_API_KEY",
            },
            new SourceHealthInfo
            {
                Source = "Indeed Direct",
                Mode = "McpPlugin",
                Ready = _indeedBuffer.Count > 0,
                BufferedJobs = _indeedBuffer.Count,
                RequiredSecret = "Call POST /api/jobs/ingest_indeed before searching",
            },
            new SourceHealthInfo
            {
                Source = "Gmail Alerts",
                Mode = "AlertInbox",
                Ready = gmailConfigured,
                RequiredSecret = "GMAIL_CREDENTIALS_JSON and GMAIL_USER_EMAIL",
                LastError = gmailConfigured ? "Gmail fetch is not implemented in EminentAi yet." : null,
            },
        };
    }

    private static string FirstValue(params string?[] values) =>
        values.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value))?.Trim() ?? string.Empty;
}
