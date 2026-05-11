namespace Planora.Todo.Infrastructure.Persistence.Configurations
{
    public sealed class UserTodoViewPreferenceConfiguration : IEntityTypeConfiguration<UserTodoViewPreference>
    {
        public void Configure(EntityTypeBuilder<UserTodoViewPreference> builder)
        {
            builder.ToTable("user_todo_view_preferences", "todo");

            builder.HasKey(x => new { x.ViewerId, x.TodoItemId });

            builder.Property(x => x.ViewerId)
                .IsRequired();

            builder.Property(x => x.TodoItemId)
                .IsRequired();

            builder.Property(x => x.HiddenByViewer)
                .IsRequired()
                .HasDefaultValue(false);

            builder.Property(x => x.ViewerCategoryId)
                .IsRequired(false);

            builder.Property(x => x.CompletedByViewer)
                .IsRequired()
                .HasDefaultValue(false);

            builder.Property(x => x.CompletedByViewerAt)
                .IsRequired(false);

            builder.HasIndex(x => new { x.TodoItemId, x.ViewerId });
        }
    }
}
