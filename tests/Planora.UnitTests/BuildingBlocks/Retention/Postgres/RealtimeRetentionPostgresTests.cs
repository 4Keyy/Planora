using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Planora.BuildingBlocks.Application.Messaging;
using Planora.BuildingBlocks.Infrastructure.Retention;
using Planora.Realtime.Domain.Entities;
using Planora.Realtime.Infrastructure.Persistence;
using Planora.Realtime.Infrastructure.Retention;
using static Planora.UnitTests.BuildingBlocks.Retention.Postgres.RetentionTestKit;

namespace Planora.UnitTests.BuildingBlocks.Retention.Postgres;

/// <summary>
/// RealtimeApi's notification log, live on PostgreSQL: read notifications go 3 days after they were
/// read, unread ones 90 days after they arrived (a June notification is long past that by October),
/// and delivered delivery-audit rows after 30 days; everything younger, and every undelivered row, stays.
/// </summary>
[Trait("TestType", "Integration")]
public sealed class RealtimeRetentionPostgresTests
{
    private static readonly Guid Recipient = Guid.NewGuid();

    private static async Task<(TemporaryDatabase Database, ServiceProvider Services)> CreateAsync()
    {
        var database = await TemporaryDatabase.CreateAsync();
        var services = new ServiceCollection();
        services.AddScoped(_ => new RealtimeDbContext(database.Options<RealtimeDbContext>(), Mock.Of<IDomainEventDispatcher>()));
        services.AddScoped<DbContext>(sp => sp.GetRequiredService<RealtimeDbContext>());
        var provider = services.BuildServiceProvider();

        await using var scope = provider.CreateAsyncScope();
        await scope.ServiceProvider.GetRequiredService<RealtimeDbContext>().Database.EnsureCreatedAsync();
        return (database, provider);
    }

    private static Notification Arrived(string title, DateTime occurredOnUtc) =>
        new(Recipient, title, "body", "TaskShared", occurredOnUtc, Guid.NewGuid());

    private static Notification Read(string title, DateTime readAtUtc)
    {
        var notification = Arrived(title, readAtUtc.AddDays(-1));
        notification.MarkRead();
        Set(notification, nameof(Notification.ReadAtUtc), readAtUtc);
        return notification;
    }

    [PostgresFact]
    public async Task NotificationPolicies_PurgeExactlyWhatHasOutlivedItsWindow()
    {
        var (database, provider) = await CreateAsync();
        await using var _ = database;
        await using var __ = provider;
        var now = DateTime.UtcNow;

        await using (var scope = provider.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<RealtimeDbContext>();
            db.Notifications.AddRange(
                Read("read last week", now.AddDays(-7)),
                Read("read four days ago", now.AddDays(-4)),
                Read("read yesterday", now.AddDays(-1)),
                Arrived("unread since June", now.AddDays(-109)),
                Arrived("unread since May", now.AddDays(-140)),
                Arrived("unread since June, too", now.AddDays(-100)),
                Arrived("unread this month", now.AddDays(-20)));

            NotificationDelivery Delivered(DateTime at)
            {
                var delivery = new NotificationDelivery(Guid.NewGuid(), Recipient);
                delivery.MarkDelivered();
                Set(delivery, nameof(NotificationDelivery.DeliveredAtUtc), at);
                return delivery;
            }

            var neverDelivered = new NotificationDelivery(Guid.NewGuid(), Recipient);
            neverDelivered.MarkFailed("socket closed");
            Set(neverDelivered, nameof(NotificationDelivery.CreatedAt), now.AddDays(-60));
            db.NotificationDeliveries.AddRange(
                Delivered(now.AddDays(-45)), Delivered(now.AddDays(-35)), Delivered(now.AddDays(-31)),
                Delivered(now.AddDays(-3)),
                neverDelivered);
            await db.SaveChangesAsync();
        }

        var options = Live();
        await using (var scope = provider.CreateAsyncScope())
        {
            var read = await RunAsync(new ReadNotificationPurgePolicy(new PostgresRetentionLock(), NullLogger<ReadNotificationPurgePolicy>.Instance), scope.ServiceProvider, options, now);
            var unread = await RunAsync(new UnreadNotificationPurgePolicy(new PostgresRetentionLock(), NullLogger<UnreadNotificationPurgePolicy>.Instance), scope.ServiceProvider, options, now);
            var deliveries = await RunAsync(new NotificationDeliveryPurgePolicy(new PostgresRetentionLock(), NullLogger<NotificationDeliveryPurgePolicy>.Instance), scope.ServiceProvider, options, now);

            Assert.Equal(2, read.Deleted);
            Assert.Equal(3, unread.Deleted);
            Assert.Equal(3, deliveries.Deleted);
        }

        await using (var scope = provider.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<RealtimeDbContext>();
            var titles = await db.Notifications.IgnoreQueryFilters().Select(n => n.Title).ToListAsync();
            Assert.Equal(new[] { "read yesterday", "unread this month" }.Order(), titles.Order());

            var deliveries = await db.NotificationDeliveries.IgnoreQueryFilters().ToListAsync();
            Assert.Equal(2, deliveries.Count);
            Assert.Contains(deliveries, d => d.DeliveredAtUtc is null);
        }
    }
}
