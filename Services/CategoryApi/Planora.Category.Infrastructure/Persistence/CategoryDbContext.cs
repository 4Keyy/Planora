using Planora.BuildingBlocks.Domain;
using Planora.BuildingBlocks.Infrastructure;
using Planora.BuildingBlocks.Infrastructure.Outbox;
using Microsoft.EntityFrameworkCore;
using System.Linq;
using System.Reflection;
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

            domainEntities.ForEach(entity => entity.ClearDomainEvents());

            var result = await base.SaveChangesAsync(cancellationToken);

            foreach (var domainEvent in domainEvents)
            {
                await _domainEventDispatcher.DispatchAsync(domainEvent, cancellationToken);
            }

            return result;
        }
    }
}
