using Planora.Auth.Domain.Enums;

namespace Planora.Auth.Infrastructure.Persistence.Configurations
{
    public sealed class FriendshipConfiguration : IEntityTypeConfiguration<Friendship>
    {
        public void Configure(EntityTypeBuilder<Friendship> builder)
        {
            builder.ToTable("Friendships");

            builder.HasKey(f => f.Id);

            builder.Property(f => f.RequesterId)
                .IsRequired();

            builder.Property(f => f.AddresseeId)
                .IsRequired();

            builder.Property(f => f.Status)
                .HasConversion<string>()
                .IsRequired();

            builder.Property(f => f.RequestedAt)
                .IsRequired(false);

            builder.Property(f => f.AcceptedAt)
                .IsRequired(false);

            builder.Property(f => f.RejectedAt)
                .IsRequired(false);

            builder.HasIndex(f => new { f.RequesterId, f.AddresseeId });
            builder.HasIndex(f => new { f.AddresseeId, f.RequesterId });
            builder.HasIndex(f => f.Status);

            builder.HasOne(f => f.Requester)
                .WithMany()
                .HasForeignKey(f => f.RequesterId)
                .OnDelete(DeleteBehavior.Restrict);

            builder.HasOne(f => f.Addressee)
                .WithMany()
                .HasForeignKey(f => f.AddresseeId)
                .OnDelete(DeleteBehavior.Restrict);

            builder.HasQueryFilter(f =>
                !f.IsDeleted &&
                (f.Requester == null || !f.Requester.IsDeleted) &&
                (f.Addressee == null || !f.Addressee.IsDeleted));
        }
    }
}

