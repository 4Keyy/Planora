namespace Planora.Todo.Infrastructure.Persistence.Configurations
{
    public sealed class TodoItemCommentConfiguration : IEntityTypeConfiguration<TodoItemComment>
    {
        public void Configure(EntityTypeBuilder<TodoItemComment> builder)
        {
            builder.ToTable("todo_item_comments");

            builder.HasKey(x => x.Id);

            builder.Property(x => x.TodoItemId).IsRequired();
            builder.Property(x => x.AuthorId).IsRequired();

            builder.Property(x => x.AuthorName)
                .IsRequired()
                .HasMaxLength(200);

            builder.Property(x => x.Content)
                .IsRequired()
                .HasMaxLength(2000);

            builder.Property(x => x.CreatedAt).IsRequired();
            builder.Property(x => x.UpdatedAt).IsRequired(false);
            builder.Property(x => x.DeletedAt).IsRequired(false);
            builder.Property(x => x.IsDeleted).HasDefaultValue(false);

            builder.HasIndex(x => new { x.TodoItemId, x.CreatedAt });

            builder.HasOne<TodoItem>()
                .WithMany()
                .HasForeignKey(x => x.TodoItemId)
                .OnDelete(DeleteBehavior.Cascade);
        }
    }
}
