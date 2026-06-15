using Planora.Todo.Domain.Enums;

namespace Planora.Todo.Infrastructure.Persistence.Configurations
{
    public sealed class TodoItemConfiguration : IEntityTypeConfiguration<TodoItem>
    {
        public void Configure(EntityTypeBuilder<TodoItem> builder)
        {
            builder.HasKey(x => x.Id);

            // 1500 accommodates a subtask's full content (a subtask has no separate body; its
            // text lives in the title). Regular-task titles are still held to 200 chars by their
            // create validator + UI. On an existing migration-built database this widening is also
            // applied at startup (see TodoApi Program.cs) so the column matches this model.
            builder.Property(x => x.Title)
                .IsRequired()
                .HasMaxLength(1500);

            builder.Property(x => x.Description)
                .HasMaxLength(2000);

            builder.Property(x => x.Status)
                .HasConversion(v => v.ToString(), v => Enum.Parse<TodoStatus>(v))
                .HasDefaultValue(TodoStatus.Todo);

            builder.Property(x => x.Priority)
                .HasConversion(v => (int)v, v => (TodoPriority)v)
                .HasDefaultValue(TodoPriority.Medium)
                .HasSentinel((TodoPriority)0);

            builder.Property(x => x.UserId)
                .IsRequired();

            // Creator of the item — only populated for subtasks (a collaborator may add one). Null
            // for top-level tasks, where the owner is the creator. On existing migration-built
            // databases the column is added at startup (see TodoApi Program.cs).
            builder.Property(x => x.CreatedByUserId)
                .IsRequired(false);

            builder.Property(x => x.IsPublic)
                .HasDefaultValue(false);

            builder.Property(x => x.Hidden)
                .HasDefaultValue(false);

            builder.Property(x => x.CreatedAt)
                .IsRequired()
                .ValueGeneratedOnAdd();

            builder.Property(x => x.UpdatedAt)
                .IsRequired(false);

            builder.Property(x => x.DeletedAt)
                .IsRequired(false);

            builder.Property(x => x.IsDeleted)
                .HasDefaultValue(false);

            builder.Property(x => x.ParentTodoId)
                .IsRequired(false);

            builder.HasIndex(x => x.UserId);
            builder.HasIndex(x => x.CategoryId);
            builder.HasIndex(x => new { x.UserId, x.Status });
            builder.HasIndex(x => new { x.UserId, x.IsDeleted });
            builder.HasIndex(x => x.CreatedAt);

            // Subtask tree: self-reference to the parent task. NoAction on delete — parent
            // deletion soft-deletes children explicitly in the delete handler (cascade would
            // not respect the soft-delete model). Indexed for fast "children of X" lookups.
            builder.HasIndex(x => new { x.ParentTodoId, x.IsDeleted, x.CreatedAt })
                .HasDatabaseName("ix_todo_items_parent_deleted_created");

            builder.HasOne<TodoItem>()
                .WithMany()
                .HasForeignKey(x => x.ParentTodoId)
                .OnDelete(DeleteBehavior.NoAction);

            // Composite covering index for the most common query: user's non-deleted todos by status, sorted by time
            builder.HasIndex(x => new { x.UserId, x.Status, x.IsDeleted, x.CreatedAt })
                .HasDatabaseName("ix_todo_items_user_status_deleted_created");

            builder.OwnsMany(x => x.Tags, navigation =>
            {
                navigation.HasKey(x => x.Id);
                navigation.Property(x => x.Name)
                    .IsRequired()
                    .HasMaxLength(50);

                navigation.WithOwner()
                    .HasForeignKey("TodoItemId");

                navigation.ToTable("todo_tags");
            });

            builder.HasMany(x => x.SharedWith)
                .WithOne()
                .HasForeignKey(x => x.TodoItemId)
                .OnDelete(DeleteBehavior.Cascade);

            builder.Property(x => x.RequiredWorkers).IsRequired(false);

            builder.HasMany(x => x.Workers)
                .WithOne()
                .HasForeignKey(x => x.TodoItemId)
                .OnDelete(DeleteBehavior.Cascade);
        }
    }
}
