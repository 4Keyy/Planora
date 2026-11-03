namespace Planora.Auth.Infrastructure.Persistence.Configurations;

public sealed class RoleConfiguration : IEntityTypeConfiguration<global::Planora.Auth.Domain.Entities.Role>
{
    public void Configure(EntityTypeBuilder<global::Planora.Auth.Domain.Entities.Role> builder)
    {
        builder.ToTable("Roles");

        builder.HasKey(r => r.Id);

        builder.Property(r => r.Name)
            .IsRequired()
            .HasMaxLength(100);

        builder.HasIndex(r => r.Name)
            .IsUnique();

        builder.Property(r => r.Description)
            .HasMaxLength(500);

        builder.Property(r => r.CreatedAt)
            .IsRequired();

        builder.HasMany(r => r.UserRoles)
            .WithOne(ur => ur.Role)
            .HasForeignKey(ur => ur.RoleId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasQueryFilter(r => !r.IsDeleted);

        // Model-managed values must be immutable across builds. Existing databases keep their
        // role IDs during guarded baseline adoption; these IDs apply to fresh schema creation.
        builder.HasData(
            new
            {
                Id = new Guid("075a45ef-828e-50e7-af6a-7587be5a997b"),
                Name = "Admin",
                Description = "System administrator with full access",
                CreatedAt = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc),
                IsDeleted = false
            },
            new
            {
                Id = new Guid("0a00159e-af48-5e76-a909-55edb8c61fc7"),
                Name = "User",
                Description = "Regular user with standard access",
                CreatedAt = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc),
                IsDeleted = false
            });
    }
}
