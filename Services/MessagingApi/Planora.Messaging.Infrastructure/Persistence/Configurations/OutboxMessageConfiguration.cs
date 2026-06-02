using Planora.BuildingBlocks.Application.Outbox;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Planora.Messaging.Infrastructure.Persistence.Configurations;

/// <summary>
/// EF entity configuration for `OutboxMessage` in the Messaging service.
///
/// Brings the Messaging-side schema in line with Auth / Category / Realtime —
/// previously the DbSet was declared on `MessagingDbContext` but no explicit
/// configuration was applied, so EF used defaults (no indexes beyond the PK).
/// This caused the outbox processor to seq-scan the table on every poll once
/// the table grew past a few thousand rows.
///
/// Indexes match the canonical shape:
///   * `(Status, OccurredOnUtc)` — Pending-branch poll ordering.
///   * `ProcessedOnUtc` — cleanup sweep.
///   * Partial `(Status, NextRetryUtc, OccurredOnUtc)` filtered to
///     `Status IN ('Pending', 'Failed')` — T4.2 read-path optimisation.
/// </summary>
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
