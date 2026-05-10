namespace Planora.Auth.Infrastructure.Persistence.Configurations
{
    public sealed class LoginHistoryConfiguration : IEntityTypeConfiguration<LoginHistory>
    {
        public void Configure(EntityTypeBuilder<LoginHistory> builder)
        {
            builder.ToTable("LoginHistory");

            builder.HasKey(lh => lh.Id);

            builder.Property(lh => lh.IpAddress)
                .IsRequired()
                .HasMaxLength(50);

            builder.Property(lh => lh.UserAgent)
                .IsRequired()
                .HasMaxLength(500);

            builder.Property(lh => lh.FailureReason)
                .HasMaxLength(500);

            builder.HasIndex(lh => lh.UserId);
            builder.HasIndex(lh => lh.LoginAt);
            builder.HasIndex(lh => lh.IsSuccessful);
            builder.HasIndex(lh => lh.IsDeleted);

            builder.HasQueryFilter(lh => !lh.IsDeleted && !lh.User.IsDeleted);
        }
    }
}
