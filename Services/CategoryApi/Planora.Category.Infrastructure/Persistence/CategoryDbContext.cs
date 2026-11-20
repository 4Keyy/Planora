using Planora.BuildingBlocks.Domain;
using Planora.BuildingBlocks.Application.Messaging;
using Planora.BuildingBlocks.Application.Messaging.Events;
using Planora.BuildingBlocks.Application.Outbox;
using Planora.Category.Domain.Events;
using Microsoft.EntityFrameworkCore;
using System.Linq;
using System.Reflection;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace Planora.Category.Infrastructure.Persistence
{
    public sealed class CategoryDbContext : DbContext
    {
        private readonly IDomainEventDispatcher _domainEventDispatcher;

        public DbSet<Domain.Entities.Category> Categories { get; set; }
        public DbSet<OutboxMessage> OutboxMessages => Set<OutboxMessage>();

        public CategoryDbContext(
            DbContextOptions<CategoryDbContext> options,
            IDomainEventDispatcher domainEventDispatcher)
            : base(options)
        {
            _domainEventDispatcher = domainEventDispatcher;
        }

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);
            modelBuilder.ApplyConfigurationsFromAssembly(Assembly.GetExecutingAssembly());

            // Optimistic concurrency for the Category aggregate via PostgreSQL's
            // xmin system column. Guarded so the InMemory test provider is unaffected.
            if (Database.IsNpgsql())
            {
                modelBuilder.Entity<Domain.Entities.Category>()
                    .Property<uint>("xmin")
                    .HasColumnName("xmin")
                    .HasColumnType("xid")
                    .ValueGeneratedOnAddOrUpdate()
                    .IsConcurrencyToken();
            }
        }

        public override async Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
        {
            var domainEntities = ChangeTracker
                .Entries<BaseEntity>()
                .Where(x => x.Entity.DomainEvents.Any())
                .Select(x => x.Entity)
                .ToList();

            var domainEvents = domainEntities
                .SelectMany(x => x.DomainEvents)
                .ToList();

            var deletionMessages = domainEvents.OfType<CategoryDeletedDomainEvent>()
                .Select(domainEvent =>
                {
                    var integrationEvent = new CategoryDeletedIntegrationEvent(domainEvent.CategoryId, domainEvent.UserId);
                    var type = typeof(CategoryDeletedIntegrationEvent);
                    return new OutboxMessage(type.AssemblyQualifiedName ?? type.Name, JsonSerializer.Serialize(integrationEvent), DateTime.UtcNow);
                })
                .ToList();

            OutboxMessages.AddRange(deletionMessages);
            int result;
            try
            {
                // The category update and its deletion messages share the owner save and transaction.
                result = await base.SaveChangesAsync(cancellationToken);
            }
            catch
            {
                // Discard the new entries and preserve the domain events if this context retries.
                OutboxMessages.RemoveRange(deletionMessages);
                throw;
            }

            domainEntities.ForEach(entity => entity.ClearDomainEvents());

            foreach (var domainEvent in domainEvents.Where(domainEvent => domainEvent is not CategoryDeletedDomainEvent))
            {
                await _domainEventDispatcher.DispatchAsync(domainEvent, cancellationToken);
            }

            return result;
        }
    }
}
