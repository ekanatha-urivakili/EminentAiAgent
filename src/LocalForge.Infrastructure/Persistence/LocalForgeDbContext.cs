using LocalForge.Domain;
using Microsoft.EntityFrameworkCore;

namespace LocalForge.Infrastructure.Persistence;

public class LocalForgeDbContext : DbContext
{
    public LocalForgeDbContext(DbContextOptions<LocalForgeDbContext> options) : base(options) { }

    public DbSet<Conversation> Conversations => Set<Conversation>();
    public DbSet<Branch> Branches => Set<Branch>();
    public DbSet<Message> Messages => Set<Message>();
    public DbSet<MessageAttachment> MessageAttachments => Set<MessageAttachment>();
    public DbSet<AdminUser> AdminUsers => Set<AdminUser>();
    public DbSet<AgentRun> AgentRuns => Set<AgentRun>();
    public DbSet<AgentStep> AgentSteps => Set<AgentStep>();
    public DbSet<ConnectorConfig> Connectors => Set<ConnectorConfig>();
    public DbSet<PolicyRule> PolicyRules => Set<PolicyRule>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Conversation>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.HasMany(e => e.Branches)
                  .WithOne(e => e.Conversation)
                  .HasForeignKey(e => e.ConversationId)
                  .OnDelete(DeleteBehavior.Cascade);
            entity.HasMany(e => e.AgentRuns)
                  .WithOne(e => e.Conversation)
                  .HasForeignKey(e => e.ConversationId)
                  .OnDelete(DeleteBehavior.SetNull);
            entity.HasIndex(e => e.CreatedAt);
        });

        modelBuilder.Entity<Branch>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.HasMany(e => e.Messages)
                  .WithOne(e => e.Branch)
                  .HasForeignKey(e => e.BranchId)
                  .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<Message>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => new { e.BranchId, e.CreatedAt });
            entity.HasMany(e => e.Attachments)
                  .WithOne(e => e.Message)
                  .HasForeignKey(e => e.MessageId)
                  .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<MessageAttachment>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => e.MessageId);
        });

        modelBuilder.Entity<AdminUser>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => e.Email).IsUnique();
        });

        modelBuilder.Entity<AgentRun>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.HasMany(e => e.Steps)
                  .WithOne(e => e.Run)
                  .HasForeignKey(e => e.RunId)
                  .OnDelete(DeleteBehavior.Cascade);
            entity.HasIndex(e => e.StartedAt);
        });

        modelBuilder.Entity<AgentStep>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => new { e.RunId, e.Ordinal });
        });

        modelBuilder.Entity<ConnectorConfig>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.HasIndex(e => e.Name).IsUnique();
            entity.HasMany(e => e.Rules)
                  .WithOne(e => e.Connector)
                  .HasForeignKey(e => e.ConnectorId)
                  .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<PolicyRule>(entity =>
        {
            entity.HasKey(e => e.Id);
        });
    }
}
