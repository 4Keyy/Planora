using System.Data.Common;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Planora.BuildingBlocks.Application.Messaging;
using Planora.BuildingBlocks.Application.Messaging.Events;
using Planora.Realtime.Application.Handlers;
using Planora.Realtime.Application.Interfaces;
using Planora.Realtime.Application.Response;
using Planora.Realtime.Domain.Entities;
using Planora.Realtime.Infrastructure.Persistence;
using Planora.Realtime.Infrastructure.Services;
using Planora.UnitTests.BuildingBlocks.Retention.Postgres;

namespace Planora.UnitTests.Services.RealtimeApi.Infrastructure;

[Trait("TestType", "Integration")]
public sealed class NotificationDeletionPostgresTests
{
    [PostgresFact]
    public async Task TaskCleanup_DropsReplayAndFirstLateDeliveryAcrossContexts()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await MigrateAsync(database);
        var recipient = Guid.NewGuid();
        var task = Guid.NewGuid();
        var original = Event(recipient, task);
        var unrelated = Event(recipient, Guid.NewGuid());
        var push = new Mock<INotificationService>();

        await DeliverAsync(database, original, push.Object);
        await DeliverAsync(database, original, push.Object);
        await DeliverAsync(database, unrelated, push.Object);

        await using (var db = NewContext(database))
        {
            var notes = await db.Notifications.ToListAsync();
            db.NotificationDeliveries.AddRange(notes.Select(note => new NotificationDelivery(note.Id, note.UserId)));
            await db.SaveChangesAsync();
        }

        await using (var db = NewContext(database))
        {
            Assert.Equal(1, await Store(db).DeleteByTaskIdAsync(task));
            Assert.Equal(0, await Store(db).DeleteByTaskIdAsync(task));
        }

        await DeliverAsync(database, original, push.Object);
        await DeliverAsync(database, Event(Guid.NewGuid(), task), push.Object);
        await DeliverAsync(database, Event(recipient), push.Object);

        await using var check = NewContext(database);
        var remaining = await check.Notifications.IgnoreQueryFilters().ToListAsync();
        Assert.Equal(2, remaining.Count);
        Assert.DoesNotContain(remaining, note => note.TaskId == task);
        Assert.Contains(remaining, note => note.TaskId == Guid.Empty);
        var delivery = Assert.Single(await check.NotificationDeliveries.ToListAsync());
        Assert.Equal(Assert.Single(remaining, note => note.SourceEventId == unrelated.Id).Id, delivery.NotificationId);
        push.Verify(service => service.SendToUserAsync(It.IsAny<NotificationPayload>(), It.IsAny<CancellationToken>()), Times.Exactly(3));
    }

    [PostgresFact]
    public async Task UserCleanup_BlocksFirstLateDeliveryEvenWhenTheLogWasEmpty()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await MigrateAsync(database);
        var deletedUser = Guid.NewGuid();
        var activeUser = Guid.NewGuid();
        var task = Guid.NewGuid();
        var push = new Mock<INotificationService>();

        await using (var db = NewContext(database))
        {
            Assert.Equal(0, await Store(db).DeleteByUserIdAsync(deletedUser));
            Assert.Equal(0, await Store(db).DeleteByTaskIdAsync(Guid.Empty));
        }

        await DeliverAsync(database, Event(deletedUser, task), push.Object);
        await DeliverAsync(database, Event(deletedUser), push.Object);
        await DeliverAsync(database, Event(activeUser, task), push.Object);
        await DeliverAsync(database, Event(activeUser), push.Object);

        await using var check = NewContext(database);
        var remaining = await check.Notifications.IgnoreQueryFilters().ToListAsync();
        Assert.Equal(2, remaining.Count);
        Assert.All(remaining, note => Assert.Equal(activeUser, note.UserId));
        push.Verify(service => service.SendToUserAsync(It.IsAny<NotificationPayload>(), It.IsAny<CancellationToken>()), Times.Exactly(2));
    }

    [PostgresFact]
    public async Task ConcurrentInsert_WaitsForCleanupAndSeesTheCommittedDeletion()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await MigrateAsync(database);
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(20));
        var token = timeout.Token;
        var task = Guid.NewGuid();
        var recipient = Guid.NewGuid();
        var pause = new PauseBeforeDeliveryCleanup();
        await using var cleanupDb = new RealtimeDbContext(new DbContextOptionsBuilder<RealtimeDbContext>(database.Options<RealtimeDbContext>())
            .AddInterceptors(pause).Options, Mock.Of<IDomainEventDispatcher>());
        await using var writerDb = NewContext(database);
        var cleanup = Store(cleanupDb).DeleteByTaskIdAsync(task, token);
        try
        {
            await pause.Entered.Task.WaitAsync(token);
            var insert = Store(writerDb).TryAddAsync(new Notification(recipient, "Title", "Body", "task.review",
                DateTime.UtcNow, Guid.NewGuid(), task), token);
            try
            {
                await using var observer = NewContext(database);
                while (!await observer.Database.SqlQueryRaw<bool>("""
                    SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_locks
                        WHERE locktype = 'advisory' AND NOT granted
                            AND database = (SELECT oid FROM pg_catalog.pg_database WHERE datname = current_database())) AS "Value"
                    """).SingleAsync(token))
                {
                    if (insert.IsCompleted)
                    {
                        await insert;
                        Assert.Fail("Insert completed before the deletion transaction committed.");
                    }
                    await Task.Delay(25, token);
                }
                pause.Resume.TrySetResult();
                Assert.Equal(0, await cleanup);
                Assert.False(await insert);
                Assert.Empty(await observer.Notifications.IgnoreQueryFilters().ToListAsync(token));
            }
            finally
            {
                pause.Resume.TrySetResult();
                await insert;
            }
        }
        finally
        {
            pause.Resume.TrySetResult();
            await cleanup;
        }
    }

    [PostgresFact]
    public async Task FailedCleanup_RollsBackMarkerAndDeliveryRemoval()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await MigrateAsync(database);
        var note = new Notification(Guid.NewGuid(), "Title", "Body", "task.review", DateTime.UtcNow, Guid.NewGuid(), Guid.NewGuid());
        await using (var db = NewContext(database))
        {
            Assert.True(await Store(db).TryAddAsync(note));
            db.NotificationDeliveries.Add(new NotificationDelivery(note.Id, note.UserId));
            await db.SaveChangesAsync();
            await db.Database.ExecuteSqlRawAsync("""
                CREATE FUNCTION reject_notification_delete() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN RAISE EXCEPTION 'Synthetic cleanup failure'; END $$;
                CREATE TRIGGER reject_notification_delete BEFORE DELETE ON "Notifications"
                FOR EACH ROW EXECUTE FUNCTION reject_notification_delete();
                """);
            var error = await Assert.ThrowsAsync<Npgsql.PostgresException>(() => Store(db).DeleteByTaskIdAsync(note.TaskId));
            Assert.Equal("Synthetic cleanup failure", error.MessageText);
        }

        await using var check = NewContext(database);
        Assert.Equal(note.Id, (await check.Notifications.SingleAsync()).Id);
        Assert.Equal(note.Id, (await check.NotificationDeliveries.SingleAsync()).NotificationId);
        Assert.True(await Store(check).TryAddAsync(new Notification(note.UserId, "Title", "Body", "task.review",
            DateTime.UtcNow, Guid.NewGuid(), note.TaskId)));
    }

    private static async Task MigrateAsync(TemporaryDatabase database)
    {
        await using var db = NewContext(database);
        await db.Database.MigrateAsync();
    }

    private static async Task DeliverAsync(TemporaryDatabase database, NotificationEvent @event, INotificationService push)
    {
        await using var db = NewContext(database);
        var handler = new NotificationEventHandler(NullLogger<NotificationEventHandler>.Instance, Store(db), push);
        await handler.HandleAsync(@event);
    }

    private static RealtimeDbContext NewContext(TemporaryDatabase database) =>
        new(database.Options<RealtimeDbContext>(), Mock.Of<IDomainEventDispatcher>());

    private static NotificationStore Store(RealtimeDbContext db) => new(db, NullLogger<NotificationStore>.Instance);

    private static NotificationEvent Event(Guid user, Guid task = default) =>
        new(user, "Synthetic title", "Synthetic body", NotificationType.CommentAdded, task);

    private sealed class PauseBeforeDeliveryCleanup : DbCommandInterceptor
    {
        public TaskCompletionSource Entered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource Resume { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public override async ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(DbCommand command,
            CommandEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            if (command.CommandText.StartsWith("DELETE FROM \"NotificationDeliveries\"", StringComparison.Ordinal))
            {
                Entered.TrySetResult();
                await Resume.Task.WaitAsync(cancellationToken);
            }
            return result;
        }
    }
}
