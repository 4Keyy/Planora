using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Planora.BuildingBlocks.Application.Outbox;

namespace Planora.Realtime.Infrastructure.Persistence.Configurations;

public sealed class OutboxMessageConfiguration : IEntityTypeConfiguration<OutboxMessage>
{
    public void Configure(EntityTypeBuilder<OutboxMessage> builder)
    {
        builder.ToTable("OutboxMessages");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.Type)
            .IsRequired()
            .HasMaxLength(255);

        builder.Property(x => x.Content)
            .IsRequired();

        builder.Property(x => x.OccurredOnUtc)
            .IsRequired();

        builder.Property(x => x.ProcessedOnUtc);

        builder.Property(x => x.Status)
            .IsRequired()
            .HasConversion<string>();

        builder.Property(x => x.Error)
            .HasMaxLength(2000);

        builder.Property(x => x.RetryCount)
            .IsRequired()
            .HasDefaultValue(0);

        builder.HasIndex(x => new { x.Status, x.OccurredOnUtc });
        builder.HasIndex(x => x.ProcessedOnUtc);

        // T4.2 — partial index covering the canonical polling predicate
        // (`Status = 'Pending' OR (Status = 'Failed' AND NextRetryUtc <= NOW)`).
        // Excluding `Processed` + `DeadLettered` keeps the index small even when
        // the table grows: those terminal rows accumulate until the cleanup
        // sweep runs and would otherwise bloat the read path on every poll.
        builder.HasIndex(x => new { x.Status, x.NextRetryUtc, x.OccurredOnUtc })
            .HasFilter("\"Status\" IN ('Pending', 'Failed')")
            .HasDatabaseName("ix_outbox_messages_active");
    }
}
