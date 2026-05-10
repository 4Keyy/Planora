namespace Planora.Auth.Infrastructure.Persistence.Configurations;

public sealed class UserRoleConfiguration : IEntityTypeConfiguration<UserRole>
{
    public void Configure(EntityTypeBuilder<UserRole> builder)
    {
        builder.ToTable("UserRoles");

        builder.HasKey(ur => ur.Id);

        builder.HasIndex(ur => new { ur.UserId, ur.RoleId })
            .IsUnique();

        // Standalone FK indexes so joins from either side are index-scanned
        builder.HasIndex(ur => ur.UserId);
        builder.HasIndex(ur => ur.RoleId);

        builder.Property(ur => ur.CreatedAt)
            .IsRequired();

        builder.HasOne(ur => ur.User)
            .WithMany(u => u.UserRoles)
            .HasForeignKey(ur => ur.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne(ur => ur.Role)
            .WithMany(r => r.UserRoles)
            .HasForeignKey(ur => ur.RoleId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasQueryFilter(ur => !ur.IsDeleted && !ur.User.IsDeleted && !ur.Role.IsDeleted);
    }
}
