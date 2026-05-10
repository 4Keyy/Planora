namespace Planora.Todo.Infrastructure.Persistence.Configurations
{
    public sealed class TodoItemWorkerConfiguration : IEntityTypeConfiguration<TodoItemWorker>
    {
        public void Configure(EntityTypeBuilder<TodoItemWorker> builder)
        {
            builder.ToTable("todo_item_workers");

            builder.HasKey(x => new { x.TodoItemId, x.UserId });

            builder.Property(x => x.JoinedAt)
                .IsRequired()
                .HasDefaultValueSql("now()");

            builder.HasIndex(x => x.UserId);
            builder.HasIndex(x => x.TodoItemId);
        }
    }
}
