using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using LocalForge.Application.Abstractions;
using LocalForge.Application.Security;
using LocalForge.Domain;
using LocalForge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace LocalForge.Infrastructure.Security;

/// <summary>
/// Evaluation order: hard-deny > explicit DENY rule > most-specific matching rule >
/// connector profile default > global default (Ask).
///
/// Profile semantics (per architecture §3.7):
///   ReadOnly  → mutating tools are DENIED (not asked — the profile is a promise)
///   ReadWrite → mutating tools ASK (human-in-the-loop is non-optional for writes)
///   Blocked   → everything denied
/// </summary>
public class PolicyEngine(IDbContextFactory<LocalForgeDbContext> dbFactory) : IPolicyEngine
{
    public PolicyVerdict Evaluate(string connectorName, string toolName, JsonNode? args)
    {
        if (MutationHeuristics.IsHardDenied(connectorName, toolName))
            return PolicyVerdict.Deny;

        using var db = dbFactory.CreateDbContext();
        var connector = db.Connectors
            .Include(c => c.Rules)
            .AsNoTracking()
            .FirstOrDefault(c => c.Name == connectorName);

        // Unknown connector: never auto-allow.
        if (connector is null) return PolicyVerdict.Ask;
        if (!connector.Enabled) return PolicyVerdict.Deny;

        var matching = connector.Rules
            .Where(r => GlobMatch(r.ToolPattern, toolName))
            .OrderByDescending(Specificity)
            .ToList();

        // Any explicit deny wins outright.
        if (matching.Any(r => r.Action == PolicyAction.Deny)) return PolicyVerdict.Deny;

        var rule = matching.FirstOrDefault();
        if (rule is not null)
        {
            var verdict = rule.Action switch
            {
                PolicyAction.Allow => PolicyVerdict.Allow,
                PolicyAction.Deny => PolicyVerdict.Deny,
                _ => PolicyVerdict.Ask
            };
            // An Allow rule can never silently authorize a mutation on a ReadOnly profile.
            if (verdict == PolicyVerdict.Allow &&
                connector.PolicyProfile == PolicyProfile.ReadOnly &&
                MutationHeuristics.IsMutating(toolName))
                return PolicyVerdict.Deny;
            return verdict;
        }

        return connector.PolicyProfile switch
        {
            PolicyProfile.Blocked => PolicyVerdict.Deny,
            PolicyProfile.ReadOnly => MutationHeuristics.IsMutating(toolName) ? PolicyVerdict.Deny : PolicyVerdict.Allow,
            PolicyProfile.ReadWrite => MutationHeuristics.IsMutating(toolName) ? PolicyVerdict.Ask : PolicyVerdict.Allow,
            _ => PolicyVerdict.Ask
        };
    }

    public async Task RememberAsync(string connectorName, string toolName, bool allow, CancellationToken ct = default)
    {
        // "Remember reject" persists a deny; "remember approve" persists an allow —
        // but never for hard-denied operations.
        if (allow && MutationHeuristics.IsHardDenied(connectorName, toolName)) return;

        await using var db = await dbFactory.CreateDbContextAsync(ct);
        var connector = await db.Connectors
            .Include(c => c.Rules)
            .FirstOrDefaultAsync(c => c.Name == connectorName, ct);
        if (connector is null) return;

        var existing = connector.Rules.FirstOrDefault(r => r.ToolPattern == toolName);
        if (existing is not null)
        {
            existing.Action = allow ? PolicyAction.Allow : PolicyAction.Deny;
        }
        else
        {
            connector.Rules.Add(new PolicyRule
            {
                ConnectorId = connector.Id,
                ToolPattern = toolName, // scoped to the exact tool, never "*"
                Action = allow ? PolicyAction.Allow : PolicyAction.Deny
            });
        }
        await db.SaveChangesAsync(ct);
    }

    private static int Specificity(PolicyRule rule) =>
        rule.ToolPattern.Count(c => c != '*') - rule.ToolPattern.Count(c => c == '*');

    internal static bool GlobMatch(string pattern, string value)
    {
        if (pattern == "*") return true;
        var regex = "^" + Regex.Escape(pattern).Replace("\\*", ".*").Replace("\\?", ".") + "$";
        return Regex.IsMatch(value, regex, RegexOptions.IgnoreCase);
    }
}
