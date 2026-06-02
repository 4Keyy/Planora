using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Planora.Realtime.Domain.Entities;

namespace Planora.Realtime.Infrastructure.Persistence.Configurations;

public sealed class NotificationConfiguration : IEntityTypeConfiguration<Notification>
{
    public void Configure(EntityTypeBuilder<Notification> builder)
    {
        builder.ToTable("Notifications");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.UserId)
            .IsRequired();

        builder.Property(x => x.Title)
            .IsRequired()
            .HasMaxLength(200);

        // Body is wider than Title — todos can carry truncated description previews;
        // 2000 matches Todo description's upper bound (H3).
        builder.Property(x => x.Message)
            .IsRequired()
            .HasMaxLength(2000);

        builder.Property(x => x.Type)
            .IsRequired()
            .HasMaxLength(64);

        builder.Property(x => x.OccurredOnUtc)
            .IsRequired();

        builder.Property(x => x.SourceEventId)
            .IsRequired();

        builder.Property(x => x.CreatedAt)
            .IsRequired();

        builder.Property(x => x.IsDeleted)
            .HasDefaultValue(false);

        // Idempotency: if the same integration event is re-consumed (transient
        // RabbitMQ redelivery, replay, etc.), we want to land the row at most once.
        builder.HasIndex(x => x.SourceEventId).IsUnique();

        builder.HasIndex(x => new { x.UserId, x.OccurredOnUtc });
        builder.HasIndex(x => x.UserId);

        // Global soft-delete filter so administrative purges hide naturally from
        // user-facing queries without every call site repeating WHERE IsDeleted=false.
        builder.HasQueryFilter(x => !x.IsDeleted);
    }
}
