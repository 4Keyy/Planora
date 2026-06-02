using Microsoft.EntityFrameworkCore;
using Planora.BuildingBlocks.Application.Messaging;
using Planora.BuildingBlocks.Application.Outbox;
using Planora.BuildingBlocks.Domain;
using Planora.Realtime.Domain.Entities;
using System.Reflection;

namespace Planora.Realtime.Infrastructure.Persistence;

/// <summary>
/// Persistence boundary for the Realtime service. Holds the durable
/// <see cref="Notification"/> log + per-user <see cref="NotificationDelivery"/>
/// audit so a restarted pod can replay missed notifications instead of losing
/// them with its in-memory state (T2.5).
/// </summary>
public sealed class RealtimeDbContext : DbContext
{
    private readonly IDomainEventDispatcher _domainEventDispatcher;

    public DbSet<Notification> Notifications => Set<Notification>();
    public DbSet<NotificationDelivery> NotificationDeliveries => Set<NotificationDelivery>();
    public DbSet<OutboxMessage> OutboxMessages => Set<OutboxMessage>();

    public RealtimeDbContext(
        DbContextOptions<RealtimeDbContext> options,
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
