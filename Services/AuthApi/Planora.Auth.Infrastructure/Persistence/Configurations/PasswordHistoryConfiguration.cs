namespace Planora.Auth.Infrastructure.Persistence.Configurations
{
    public sealed class PasswordHistoryConfiguration : IEntityTypeConfiguration<PasswordHistory>
    {
        public void Configure(EntityTypeBuilder<PasswordHistory> builder)
        {
            builder.ToTable("PasswordHistory");

            builder.HasKey(ph => ph.Id);

            builder.Property(ph => ph.UserId)
                .IsRequired();

            builder.Property(ph => ph.PasswordHash)
                .IsRequired()
                .HasMaxLength(500);

            builder.Property(ph => ph.ChangedAt)
                .IsRequired();

            builder.HasIndex(ph => ph.UserId);
            builder.HasIndex(ph => ph.ChangedAt);
            builder.HasIndex(ph => new { ph.UserId, ph.ChangedAt });
            builder.HasIndex(ph => ph.IsDeleted);

            // Связь с пользователем (опционально, если нужно навигационное свойство)
            // builder.HasOne<User>()
            //     .WithMany()
            //     .HasForeignKey(ph => ph.UserId)
            //     .OnDelete(DeleteBehavior.Cascade);
        }
    }
}
