namespace EminentAi.Domain;

public class Conversation
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Title { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public string ModelDefault { get; set; } = string.Empty;
    public string SystemPrompt { get; set; } = string.Empty;

    public List<Branch> Branches { get; set; } = new();
    public List<AgentRun> AgentRuns { get; set; } = new();
}

public class Branch
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ConversationId { get; set; }
    public Guid? ParentBranchId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public Conversation Conversation { get; set; } = null!;
    public List<Message> Messages { get; set; } = new();
}

public enum MessageRole
{
    System,
    User,
    Assistant,
    Tool
}

public class Message
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid BranchId { get; set; }
    public MessageRole Role { get; set; }
    public string Content { get; set; } = string.Empty;
    public string? Model { get; set; }
    public int? TokensIn { get; set; }
    public int? TokensOut { get; set; }
    public long? LatencyMs { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    /// <summary>Regenerated replies are siblings sharing the same parent — never overwritten.</summary>
    public Guid? ParentMessageId { get; set; }

    public Branch Branch { get; set; } = null!;
    public List<MessageAttachment> Attachments { get; set; } = new();
}

public class MessageAttachment
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid MessageId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string ContentType { get; set; } = string.Empty;
    public string DataBase64 { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public Message Message { get; set; } = null!;
}

public class AdminUser
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string FullName { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = string.Empty;
    public string? SessionTokenHash { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public enum AgentRunStatus
{
    Running,
    Completed,
    Failed,
    Cancelled,
    Paused
}

public class AgentRun
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid? ConversationId { get; set; }
    public string Goal { get; set; } = string.Empty;
    public string? PlanJson { get; set; }
    public string Model { get; set; } = string.Empty;
    public AgentRunStatus Status { get; set; }
    public int StepBudget { get; set; } = 15;
    public int TokenBudget { get; set; } = 60000;
    public DateTime StartedAt { get; set; } = DateTime.UtcNow;
    public DateTime? FinishedAt { get; set; }
    public string? FinalAnswer { get; set; }

    public Conversation? Conversation { get; set; }
    public List<AgentStep> Steps { get; set; } = new();
}

public enum AgentStepKind
{
    Think,
    ToolCall,
    Approval,
    Result
}

public enum AgentStepStatus
{
    Pending,
    Approved,
    Rejected,
    Completed,
    Failed,
    Denied
}

public class AgentStep
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid RunId { get; set; }
    public int Ordinal { get; set; }
    public AgentStepKind Kind { get; set; }
    public AgentStepStatus Status { get; set; } = AgentStepStatus.Completed;
    public string? ToolName { get; set; }
    public string? ToolArgsJson { get; set; }
    public string? ResultJson { get; set; }
    public string? Thought { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public AgentRun Run { get; set; } = null!;
}

public enum ConnectorTransport
{
    Stdio,
    Sse,
    Http
}

public enum PolicyProfile
{
    ReadOnly,
    ReadWrite,
    Blocked
}

public class ConnectorConfig
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = string.Empty;
    public ConnectorTransport Transport { get; set; }
    public string CommandOrUrl { get; set; } = string.Empty;
    public string? EnvJsonEncrypted { get; set; }
    public bool Enabled { get; set; } = true;
    public PolicyProfile PolicyProfile { get; set; } = PolicyProfile.ReadOnly;

    public List<PolicyRule> Rules { get; set; } = new();
}

public enum PolicyAction
{
    Allow,
    Ask,
    Deny
}

public class PolicyRule
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid ConnectorId { get; set; }
    public string ToolPattern { get; set; } = "*";
    public PolicyAction Action { get; set; } = PolicyAction.Ask;

    public ConnectorConfig Connector { get; set; } = null!;
}

/// <summary>
/// Tracks ownership of AI-generated image files.
/// Used by GET /api/generated-images/:filename to enforce bearer token + ownership checks.
/// </summary>
public class GeneratedImage
{
    public Guid Id { get; set; } = Guid.NewGuid();  // UUID = filename without .png
    public Guid BranchId { get; set; }
    public string? SessionTokenHash { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public Branch Branch { get; set; } = null!;
}
