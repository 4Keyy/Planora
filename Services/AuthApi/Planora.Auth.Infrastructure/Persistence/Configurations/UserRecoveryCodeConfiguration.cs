using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Planora.Auth.Domain.Entities;

namespace Planora.Auth.Infrastructure.Persistence.Configurations
{
    public sealed class UserRecoveryCodeConfiguration : IEntityTypeConfiguration<UserRecoveryCode>
    {
        public void Configure(EntityTypeBuilder<UserRecoveryCode> builder)
        {
            builder.ToTable("UserRecoveryCodes");

            builder.HasKey(rc => rc.Id);

            builder.Property(rc => rc.UserId)
                .IsRequired();

            builder.Property(rc => rc.CodeHash)
                .IsRequired()
                .HasMaxLength(500);

            builder.Property(rc => rc.IsUsed)
                .IsRequired();

            builder.Property(rc => rc.UsedAt);

            builder.HasIndex(rc => rc.UserId);
            builder.HasIndex(rc => new { rc.UserId, rc.IsUsed });
            builder.HasIndex(rc => rc.IsDeleted);
        }
    }
}
