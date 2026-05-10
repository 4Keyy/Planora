namespace Planora.Todo.Infrastructure.Persistence
{
    public sealed class TodoDbContext : DbContext
    {
        public TodoDbContext(DbContextOptions<TodoDbContext> options) : base(options) { }

        public DbSet<TodoItem> TodoItems => Set<TodoItem>();
        public DbSet<TodoItemShare> TodoItemShares => Set<TodoItemShare>();
        public DbSet<UserTodoViewPreference> UserTodoViewPreferences => Set<UserTodoViewPreference>();

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);

            modelBuilder.ApplyConfigurationsFromAssembly(typeof(TodoDbContext).Assembly);

            modelBuilder.HasDefaultSchema("todo");
        }
    }
}
