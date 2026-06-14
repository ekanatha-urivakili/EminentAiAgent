namespace EminentAi.Infrastructure.Mcp;

public static class McpCommandLine
{
    public static bool TryParse(string commandLine, out string command, out string[] arguments)
    {
        command = string.Empty;
        arguments = Array.Empty<string>();

        if (string.IsNullOrWhiteSpace(commandLine)) return false;

        var tokens = new List<string>();
        var current = new System.Text.StringBuilder();
        var inSingleQuote = false;
        var inDoubleQuote = false;

        foreach (var c in commandLine)
        {
            if (c == '\'' && !inDoubleQuote)
            {
                inSingleQuote = !inSingleQuote;
                continue;
            }
            if (c == '"' && !inSingleQuote)
            {
                inDoubleQuote = !inDoubleQuote;
                continue;
            }
            if (char.IsWhiteSpace(c) && !inSingleQuote && !inDoubleQuote)
            {
                if (current.Length > 0)
                {
                    tokens.Add(current.ToString());
                    current.Clear();
                }
                continue;
            }

            current.Append(c);
        }

        if (inSingleQuote || inDoubleQuote) return false;
        if (current.Length > 0) tokens.Add(current.ToString());
        if (tokens.Count == 0) return false;

        command = tokens[0];
        arguments = tokens.Skip(1).ToArray();
        return true;
    }
}
