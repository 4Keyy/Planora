namespace Planora.Todo.Infrastructure.Persistence.Configurations
{
    public sealed class TodoItemShareConfiguration : IEntityTypeConfiguration<TodoItemShare>
    {
        public void Configure(EntityTypeBuilder<TodoItemShare> builder)
        {
            builder.ToTable("todo_item_shares");

            builder.HasKey(x => new { x.TodoItemId, x.SharedWithUserId });

            builder.Property(x => x.TodoItemId)
                .IsRequired();

            builder.Property(x => x.SharedWithUserId)
                .IsRequired();

            builder.HasIndex(x => x.SharedWithUserId);
        }
    }
}
