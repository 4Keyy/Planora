using Planora.BuildingBlocks.Infrastructure.Inbox;
using Planora.BuildingBlocks.Infrastructure.Outbox;

namespace Planora.Messaging.Infrastructure.Persistence
{
    public sealed class MessagingDbContext : DbContext
    {
        public MessagingDbContext(DbContextOptions<MessagingDbContext> options)
            : base(options)
        {
        }

        public DbSet<Message> Messages => Set<Message>();
        public DbSet<OutboxMessage> OutboxMessages => Set<OutboxMessage>();
        public DbSet<InboxMessage> InboxMessages => Set<InboxMessage>();

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);

            modelBuilder.Entity<Message>(builder =>
            {
                builder.HasKey(m => m.Id);
                builder.Property(m => m.Id).ValueGeneratedNever();
                builder.Property(m => m.Subject).IsRequired().HasMaxLength(200);
                builder.Property(m => m.Body).IsRequired();
                builder.Property(m => m.SenderId).IsRequired();
                builder.Property(m => m.RecipientId).IsRequired();
                builder.Property(m => m.ReadAt);
                builder.Property(m => m.IsArchived).HasDefaultValue(false);
                builder.Property(m => m.CreatedAt).IsRequired();

                // Indexes for common queries
                builder.HasIndex(m => m.SenderId);
                builder.HasIndex(m => m.RecipientId);
                builder.HasIndex(m => new { m.RecipientId, m.ReadAt });
                // Composite for conversation queries (both directions)
                builder.HasIndex(m => new { m.SenderId, m.RecipientId, m.CreatedAt })
                    .HasDatabaseName("ix_messages_sender_recipient_created");
                builder.HasIndex(m => m.CreatedAt);
            });
        }
    }
}
