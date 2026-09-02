namespace EminentAi.Application.Agents.ImageGeneration;

/// <summary>
/// Composes Flux2-Klein prompts for the fixed "software-engineering infographic"
/// design. The DESIGN block below is constant across every generation — only the
/// SUBJECT content (title, subtitle, cards, best practices) varies per request.
/// Keeping the design in one place guarantees every generated poster looks like
/// part of the same series.
/// </summary>
public static class InfographicPromptBuilder
{
    /// <summary>
    /// Ollama's own guidance for x/flux2-klein:latest: more than ~8 cards per image
    /// causes inaccurate/distorted text. Enforced server-side, independent of
    /// whatever the content model returns.
    /// </summary>
    public const int MaxCards = 8;

    private const string DesignBlock = """
        Create a square 1024x1024 educational software-engineering infographic.

        DESIGN AND LAYOUT:
        clean editorial infographic, white background, thin purple outer border,
        large bold hand-drawn black uppercase headline,
        yellow ribbon-shaped subtitle banner,
        structured equal-sized rounded rectangular cards,
        consistent spacing and alignment,
        thin pastel-coloured card borders,
        numbered circular badges in alternating blue, purple, green and orange,
        simple technical flow diagrams,
        minimal flat vector icons,
        black connector arrows,
        soft pastel blue, green, yellow, pink and purple component boxes,
        small concise bullet points,
        high information density but visually organised,
        professional developer cheat-sheet,
        modern engineering reference poster,
        friendly hand-drawn typography,
        crisp vector appearance,
        strong visual hierarchy,
        balanced whitespace,
        social-media-ready educational poster.

        TYPOGRAPHY:
        Render every quoted heading, title and bullet exactly as written, with correct spelling.
        Use uppercase condensed lettering for card titles.
        Use clean readable sans-serif text for bullets.
        Keep all text horizontal and clearly legible.

        CARD STRUCTURE:
        Each card must contain:
        1. a coloured numbered circle;
        2. a short uppercase title;
        3. one simple technical diagram;
        4. exactly three concise bullet points.
        """;

    private const string AvoidBlock = """
        AVOID:
        photorealism, 3D rendering, gradients, dark background, excessive decoration,
        paragraphs, overlapping text, distorted letters, random symbols,
        cropped cards, duplicated card numbers and inconsistent spacing.
        """;

    public static string BuildPrompt(InfographicSpec spec)
    {
        var cards = spec.Cards.Count > MaxCards ? spec.Cards.Take(MaxCards).ToList() : spec.Cards;
        var (columns, rows) = LayoutFor(cards.Count);

        var sb = new System.Text.StringBuilder();
        sb.AppendLine(DesignBlock);
        sb.AppendLine();
        sb.AppendLine("SUBJECT:");
        sb.AppendLine($"Title: \"{spec.Title}\"");
        sb.AppendLine($"Subtitle: \"{spec.Subtitle}\"");
        sb.AppendLine();
        sb.AppendLine(rows == 1
            ? $"Create {cards.Count} numbered cards in a single row."
            : $"Create {cards.Count} numbered cards in a {columns}-column by {rows}-row grid.");
        sb.AppendLine();

        for (var i = 0; i < cards.Count; i++)
        {
            var card = cards[i];
            sb.AppendLine($"{i + 1}. \"{card.Title}\"");
            sb.AppendLine($"Diagram: {card.Diagram}.");
            sb.AppendLine($"Bullets: {string.Join("; ", card.Bullets.Select(b => $"\"{b}\""))}.");
            sb.AppendLine();
        }

        sb.AppendLine("FOOTER:");
        sb.AppendLine("Add a full-width \"BEST PRACTICES\" strip containing small icons and short labels:");
        sb.AppendLine(string.Join(", ", spec.BestPractices.Select(p => $"\"{p}\"")) + ".");
        sb.AppendLine("Add the watermark \"ekanatha.io\" subtly at the bottom.");
        sb.AppendLine();
        sb.AppendLine(AvoidBlock);

        return sb.ToString();
    }

    private static (int Columns, int Rows) LayoutFor(int cardCount)
    {
        if (cardCount <= 5) return (cardCount, 1);
        const int columns = 4;
        var rows = (int)Math.Ceiling(cardCount / (double)columns);
        return (columns, rows);
    }
}

public sealed record InfographicCard(string Title, string Diagram, IReadOnlyList<string> Bullets);

public sealed record InfographicSpec(
    string Title,
    string Subtitle,
    IReadOnlyList<InfographicCard> Cards,
    IReadOnlyList<string> BestPractices);
