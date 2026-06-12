using System.Text.RegularExpressions;
using LocalForge.Application.Abstractions;

namespace LocalForge.Infrastructure.Security;

/// <summary>
/// Pre-inference redaction: masks well-known secret formats before content is
/// persisted to SQLite or sent to the model. Regex-based by design — fast and local.
/// </summary>
public sealed partial class PiiRedactor : IPiiRedactor
{
    private static readonly (Regex Pattern, string Replacement)[] Rules =
    {
        (StripeKey(), "[REDACTED_STRIPE_KEY]"),
        (AwsAccessKey(), "[REDACTED_AWS_KEY]"),
        (GithubToken(), "[REDACTED_GITHUB_TOKEN]"),
        (SlackToken(), "[REDACTED_SLACK_TOKEN]"),
        (OpenAiKey(), "[REDACTED_API_KEY]"),
        (GoogleApiKey(), "[REDACTED_GOOGLE_KEY]"),
        (PrivateKeyBlock(), "[REDACTED_PRIVATE_KEY]"),
        (JwtToken(), "[REDACTED_JWT]"),
        (BearerHeader(), "Authorization: Bearer [REDACTED]"),
        (PasswordAssignment(), "$1[REDACTED]"),
        (CreditCard(), "[REDACTED_CARD]"),
        (Ssn(), "[REDACTED_SSN]"),
    };

    public string Redact(string input)
    {
        if (string.IsNullOrEmpty(input)) return input;
        var output = input;
        foreach (var (pattern, replacement) in Rules)
            output = pattern.Replace(output, replacement);
        return output;
    }

    [GeneratedRegex(@"\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{10,}\b")]
    private static partial Regex StripeKey();

    [GeneratedRegex(@"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b")]
    private static partial Regex AwsAccessKey();

    [GeneratedRegex(@"\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}\b")]
    private static partial Regex GithubToken();

    [GeneratedRegex(@"\bxox[bpoas]-[A-Za-z0-9-]{10,}\b")]
    private static partial Regex SlackToken();

    [GeneratedRegex(@"\bsk-[A-Za-z0-9_-]{20,}\b")]
    private static partial Regex OpenAiKey();

    [GeneratedRegex(@"\bAIza[A-Za-z0-9_-]{35}\b")]
    private static partial Regex GoogleApiKey();

    [GeneratedRegex(@"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----")]
    private static partial Regex PrivateKeyBlock();

    [GeneratedRegex(@"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b")]
    private static partial Regex JwtToken();

    [GeneratedRegex(@"Authorization:\s*Bearer\s+\S+", RegexOptions.IgnoreCase)]
    private static partial Regex BearerHeader();

    [GeneratedRegex(@"((?:password|passwd|secret|api[_-]?key|token)\s*[=:]\s*[""']?)[^\s""']{6,}", RegexOptions.IgnoreCase)]
    private static partial Regex PasswordAssignment();

    [GeneratedRegex(@"\b(?:\d[ -]?){13,16}\b(?<=\d)")]
    private static partial Regex CreditCard();

    [GeneratedRegex(@"\b\d{3}-\d{2}-\d{4}\b")]
    private static partial Regex Ssn();
}
