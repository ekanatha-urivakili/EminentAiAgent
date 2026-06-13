namespace EminentAi.Application.Abstractions;

/// <summary>Masks secrets/PII before content is persisted or sent to the model.</summary>
public interface IPiiRedactor
{
    string Redact(string input);
}
