namespace Planora.Category.Infrastructure.Persistence.Configurations
{
    public sealed class CategoryConfiguration : IEntityTypeConfiguration<Domain.Entities.Category>
    {
        public void Configure(EntityTypeBuilder<Domain.Entities.Category> builder)
        {
            builder.HasKey(x => x.Id);

            builder.Property(x => x.Name)
                .IsRequired()
                .HasMaxLength(50);

            builder.Property(x => x.Description)
                .HasMaxLength(500);

            builder.Property(x => x.Color)
                .IsRequired()
                .HasMaxLength(7)
                .HasDefaultValue("#007BFF");

            builder.Property(x => x.Icon)
                .IsRequired(false);

            builder.Property(x => x.UserId)
                .IsRequired();

            builder.Property(x => x.Order)
                .IsRequired()
                .HasDefaultValue(0);


            builder.Property(x => x.CreatedAt)
                .IsRequired()
                .ValueGeneratedOnAdd();

            builder.Property(x => x.UpdatedAt)
                .IsRequired(false);

            builder.Property(x => x.IsDeleted)
                .HasDefaultValue(false);

            builder.HasIndex(x => x.UserId);
            builder.HasIndex(x => new { x.UserId, x.IsDeleted });
            builder.HasIndex(x => x.CreatedAt);
        }
    }
}
