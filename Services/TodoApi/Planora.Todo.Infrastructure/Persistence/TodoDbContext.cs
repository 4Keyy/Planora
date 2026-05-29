namespace Planora.Todo.Infrastructure.Persistence
{
    public sealed class TodoDbContext : DbContext
    {
        public TodoDbContext(DbContextOptions<TodoDbContext> options) : base(options) { }

        public DbSet<TodoItem> TodoItems => Set<TodoItem>();
        public DbSet<TodoItemShare> TodoItemShares => Set<TodoItemShare>();
        public DbSet<UserTodoViewPreference> UserTodoViewPreferences => Set<UserTodoViewPreference>();
        public DbSet<Planora.BuildingBlocks.Application.Outbox.OutboxMessage> OutboxMessages =>
            Set<Planora.BuildingBlocks.Application.Outbox.OutboxMessage>();

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);

            modelBuilder.ApplyConfigurationsFromAssembly(typeof(TodoDbContext).Assembly);

            modelBuilder.HasDefaultSchema("todo");

            // Optimistic concurrency for the TodoItem aggregate via PostgreSQL's
            // xmin system column — no extra column or migration. Guarded by the
            // provider check so the InMemory test provider is unaffected.
            if (Database.IsNpgsql())
            {
                modelBuilder.Entity<TodoItem>()
                    .Property<uint>("xmin")
                    .HasColumnName("xmin")
                    .HasColumnType("xid")
                    .ValueGeneratedOnAddOrUpdate()
                    .IsConcurrencyToken();
            }
        }
    }
}
