using Planora.BuildingBlocks.Application.Outbox;

namespace Planora.Collaboration.Infrastructure.Persistence
{
    public sealed class CollaborationDbContext : DbContext
    {
        public CollaborationDbContext(DbContextOptions<CollaborationDbContext> options) : base(options) { }

        public DbSet<Comment> Comments => Set<Comment>();
        public DbSet<OutboxMessage> OutboxMessages => Set<OutboxMessage>();
        public DbSet<Planora.BuildingBlocks.Infrastructure.Inbox.InboxMessage> InboxMessages
            => Set<Planora.BuildingBlocks.Infrastructure.Inbox.InboxMessage>();

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);

            modelBuilder.ApplyConfigurationsFromAssembly(typeof(CollaborationDbContext).Assembly);

            modelBuilder.HasDefaultSchema("collaboration");

            // Optimistic concurrency for the Comment aggregate via PostgreSQL's xmin system
            // column — no extra column or migration. Guarded so the InMemory test provider
            // (used in unit tests) is unaffected.
            if (Database.IsNpgsql())
            {
                modelBuilder.Entity<Comment>()
                    .Property<uint>("xmin")
                    .HasColumnName("xmin")
                    .HasColumnType("xid")
                    .ValueGeneratedOnAddOrUpdate()
                    .IsConcurrencyToken();
            }
        }
    }
}
