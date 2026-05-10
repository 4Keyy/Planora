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

        builder.HasData(
            global::Planora.Auth.Domain.Entities.Role.Create("Admin", "System administrator with full access"),
            global::Planora.Auth.Domain.Entities.Role.Create("User", "Regular user with standard access")
        );
    }
}
