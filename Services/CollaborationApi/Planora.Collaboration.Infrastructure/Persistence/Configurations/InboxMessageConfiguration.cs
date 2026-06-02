using Planora.BuildingBlocks.Infrastructure.Inbox;

namespace Planora.Collaboration.Infrastructure.Persistence.Configurations
{
    /// <summary>
    /// Inbox table for consumer idempotency (INV-COMM-4). The primary key is the integration
    /// event's Id, so a redelivered event is detected by a PK existence check before the handler
    /// runs again — preventing duplicate system comments on replay/restart.
    /// </summary>
    public sealed class InboxMessageConfiguration : IEntityTypeConfiguration<InboxMessage>
    {
        public void Configure(EntityTypeBuilder<InboxMessage> builder)
        {
            builder.ToTable("InboxMessages");

            builder.HasKey(x => x.Id);

            builder.Property(x => x.MessageId)
                .IsRequired()
                .HasMaxLength(255);

            builder.Property(x => x.Type)
                .IsRequired()
                .HasMaxLength(255);

            builder.Property(x => x.Content)
                .IsRequired();

            builder.Property(x => x.ReceivedOn)
                .IsRequired();

            builder.Property(x => x.ProcessedOn);

            builder.Property(x => x.Status)
                .IsRequired()
                .HasConversion<string>();

            builder.Property(x => x.Error)
                .HasMaxLength(2000);

            // Cleanup query: processed rows older than a retention window.
            builder.HasIndex(x => new { x.Status, x.ProcessedOn });
        }
    }
}
