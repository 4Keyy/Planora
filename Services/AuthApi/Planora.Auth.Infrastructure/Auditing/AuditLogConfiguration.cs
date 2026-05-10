namespace Planora.Auth.Infrastructure.Auditing
{
    public sealed class AuditLogConfiguration : IEntityTypeConfiguration<AuditLog>
    {
        public void Configure(EntityTypeBuilder<AuditLog> builder)
        {
            builder.ToTable("AuditLogs");

            builder.HasKey(a => a.Id);

            builder.Property(a => a.Action)
                .IsRequired()
                .HasMaxLength(50);

            builder.Property(a => a.EntityName)
                .IsRequired()
                .HasMaxLength(100);

            builder.Property(a => a.EntityId)
                .IsRequired();

            builder.Property(a => a.OldValues);

            builder.Property(a => a.NewValues);

            builder.HasIndex(a => new { a.EntityName, a.EntityId });
            builder.HasIndex(a => a.CreatedAt);
        }
    }
}
