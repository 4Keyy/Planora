using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Planora.Realtime.Domain.Entities;

namespace Planora.Realtime.Infrastructure.Persistence.Configurations;

public sealed class NotificationDeliveryConfiguration : IEntityTypeConfiguration<NotificationDelivery>
{
    public void Configure(EntityTypeBuilder<NotificationDelivery> builder)
    {
        builder.ToTable("NotificationDeliveries");

        builder.HasKey(x => x.Id);

        builder.Property(x => x.NotificationId)
            .IsRequired();

        builder.Property(x => x.UserId)
            .IsRequired();

        builder.Property(x => x.Status)
            .IsRequired()
            .HasConversion<string>()
            .HasMaxLength(32);

        builder.Property(x => x.DeliveredAtUtc);

        builder.Property(x => x.AttemptCount)
            .IsRequired()
            .HasDefaultValue(0);

        builder.Property(x => x.LastError)
            .HasMaxLength(2000);

        builder.Property(x => x.CreatedAt)
            .IsRequired();

        builder.HasIndex(x => x.NotificationId);
        builder.HasIndex(x => new { x.UserId, x.Status });

        // Each (Notification, User) is delivered at most once — replay on reconnect
        // updates the same row rather than inserting a new attempt history row.
        builder.HasIndex(x => new { x.NotificationId, x.UserId }).IsUnique();
    }
}
