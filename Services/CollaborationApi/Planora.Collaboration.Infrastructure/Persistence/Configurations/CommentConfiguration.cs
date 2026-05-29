namespace Planora.Collaboration.Infrastructure.Persistence.Configurations
{
    public sealed class CommentConfiguration : IEntityTypeConfiguration<Comment>
    {
        public void Configure(EntityTypeBuilder<Comment> builder)
        {
            builder.ToTable("comments");

            builder.HasKey(x => x.Id);

            builder.Property(x => x.TaskId).IsRequired();
            builder.Property(x => x.AuthorId).IsRequired();

            builder.Property(x => x.AuthorName)
                .IsRequired()
                .HasMaxLength(200);

            builder.Property(x => x.Content)
                .IsRequired()
                .HasMaxLength(5000);

            builder.Property(x => x.CreatedAt).IsRequired();
            builder.Property(x => x.UpdatedAt).IsRequired(false);
            builder.Property(x => x.DeletedAt).IsRequired(false);
            builder.Property(x => x.IsDeleted).HasDefaultValue(false);

            builder.Property(x => x.IsSystemComment)
                .IsRequired()
                .HasDefaultValue(false);

            builder.Property(x => x.IsGenesisComment)
                .IsRequired()
                .HasDefaultValue(false);

            // Optimised for timeline reads (ordered by creation per task).
            builder.HasIndex(x => new { x.TaskId, x.CreatedAt });
        }
    }
}
