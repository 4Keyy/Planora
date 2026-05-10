namespace Planora.Auth.Infrastructure.Persistence.Configurations
{
    public sealed class RefreshTokenConfiguration : IEntityTypeConfiguration<RefreshToken>
    {
        public void Configure(EntityTypeBuilder<RefreshToken> builder)
        {
            builder.ToTable("RefreshTokens");

            builder.HasKey(rt => rt.Id);

            builder.Property(rt => rt.Token)
                .IsRequired()
                .HasMaxLength(500);

            builder.Property(rt => rt.CreatedByIp)
                .IsRequired()
                .HasMaxLength(50);

            builder.Property(rt => rt.RevokedByIp)
                .HasMaxLength(50);

            builder.Property(rt => rt.RevokedReason)
                .HasMaxLength(500);

            builder.Property(rt => rt.ReplacedByToken)
                .HasMaxLength(500);

            builder.HasIndex(rt => rt.Token)
                .IsUnique()
                .HasDatabaseName("IX_RefreshTokens_Token");

            builder.HasIndex(rt => rt.UserId);
            builder.HasIndex(rt => rt.ExpiresAt);
            builder.HasIndex(rt => rt.RevokedAt);
            builder.HasIndex(rt => rt.IsDeleted);

            builder.Property(rt => rt.RememberMe)
                .IsRequired()
                .HasDefaultValue(false);

            // Device fingerprint / session deduplication columns
            builder.Property(rt => rt.DeviceFingerprint)
                .HasMaxLength(64);

            builder.Property(rt => rt.DeviceName)
                .HasMaxLength(255);

            builder.Property(rt => rt.LastLoginAt)
                .HasDefaultValueSql("NOW()");

            builder.Property(rt => rt.LoginCount)
                .HasDefaultValue(1);

            // Partial unique index: at most one non-revoked token per (user, device).
            // PostgreSQL partial index predicates cannot use NOW(), so expiry is
            // enforced by token lifecycle logic rather than this database filter.
            builder.HasIndex(rt => new { rt.UserId, rt.DeviceFingerprint })
                .HasFilter("\"RevokedAt\" IS NULL")
                .IsUnique()
                .HasDatabaseName("ix_refresh_tokens_user_device_active");

            builder.Ignore(rt => rt.IsExpired);
            builder.Ignore(rt => rt.IsRevoked);
            builder.Ignore(rt => rt.IsActive);

            builder.HasQueryFilter(rt => !rt.IsDeleted && !rt.User.IsDeleted);
        }
    }
}
