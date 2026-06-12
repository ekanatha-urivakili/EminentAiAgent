namespace LocalForge.Application.Security;

public static class MutationHeuristics
{
    private static readonly string[] Keywords =
    {
        "create", "update", "delete", "remove", "send", "post", "push", "write",
        "transition", "execute", "run", "set", "add", "move", "archive", "cancel",
        "refund", "payout", "transfer", "publish", "merge", "close", "edit", "insert"
    };

    /// <summary>Mutations that can never be allow-listed, regardless of policy rules.</summary>
    private static readonly string[] HardDeny =
    {
        "refund", "payout", "transfer_funds", "delete_account", "wipe"
    };

    public static bool IsMutating(string toolName) =>
        Keywords.Any(k => toolName.Contains(k, StringComparison.OrdinalIgnoreCase));

    public static bool IsHardDenied(string connectorName, string toolName) =>
        connectorName.Equals("stripe", StringComparison.OrdinalIgnoreCase)
            ? HardDeny.Any(k => toolName.Contains(k, StringComparison.OrdinalIgnoreCase))
            : toolName.Contains("wipe", StringComparison.OrdinalIgnoreCase);
}
