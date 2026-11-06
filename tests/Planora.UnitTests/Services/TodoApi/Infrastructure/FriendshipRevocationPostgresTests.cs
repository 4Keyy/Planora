using System.Text.Json;
using AutoMapper;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Planora.BuildingBlocks.Application.Context;
using Planora.BuildingBlocks.Application.Messaging.Events;
using Planora.BuildingBlocks.Application.Outbox;
using Planora.BuildingBlocks.Domain.Exceptions;
using Planora.BuildingBlocks.Domain.Interfaces;
using Planora.Todo.Application.DTOs;
using Planora.Todo.Application.Features.IntegrationEvents;
using Planora.Todo.Application.Features.Todos.Commands.JoinTodo;
using Planora.Todo.Application.Services;
using Planora.Todo.Domain.Entities;
using Planora.Todo.Domain.Repositories;
using Planora.Todo.Infrastructure.Persistence;
using Planora.Todo.Infrastructure.Persistence.Repositories;
using Planora.UnitTests.BuildingBlocks.Retention.Postgres;

namespace Planora.UnitTests.Services.TodoApi.Infrastructure;

public sealed class FriendshipRevocationPostgresTests
{
    [PostgresFact]
    public async Task RevokeAsync_CleansBothTaskTreesAndPreservesOwnersOtherParticipantsAndPreferences()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var seed = await SeedAsync(database, timeout.Token);
        await using var context = ConsumerContext(database);
        var outbox = new ControlledOutbox(new OutboxRepository(context));

        await InvokeAsync(context, seed, outbox, timeout.Token);

        await AssertStateAsync(database, seed, revoked: true, timeout.Token);
        await AssertEventsAsync(database, seed, timeout.Token);
        Assert.Equal(seed.AffectedIds.Count, outbox.AttemptedMessages.Count);
        Assert.Equal(0, outbox.ImmediateWrites);
    }

    [PostgresFact]
    public async Task RevokeAsync_RemovesHistoricalWorkerEvenWhenNoShareExists()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var seed = await SeedAsync(database, timeout.Token);
        var historical = Assert.Single(seed.Rows, row => row.Id == seed.HistoricalId);
        Assert.DoesNotContain(historical.SharedWith, share => share.SharedWithUserId == seed.Bob);
        Assert.Contains(historical.Workers, worker => worker.UserId == seed.Bob);
        await using var context = ConsumerContext(database);

        await InvokeAsync(context, seed, new OutboxRepository(context), timeout.Token);

        await AssertStateAsync(database, seed, revoked: true, timeout.Token);
        var events = await AssertEventsAsync(database, seed, timeout.Token);
        Assert.Contains(events, message =>
            JsonSerializer.Deserialize<RealtimeSyncIntegrationEvent>(message.Content)!.EntityId == seed.HistoricalId);
    }

    [PostgresFact]
    public async Task RevokeAsync_StagingFailureRollsBackAndFreshContextRetryCommitsOneCompleteSet()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var seed = await SeedAsync(database, timeout.Token);
        var failure = new IOException("Synthetic second revocation signal failure");
        await using (var context = ConsumerContext(database))
        {
            var outbox = new ControlledOutbox(new OutboxRepository(context), attempt =>
            {
                if (attempt == 2) throw failure;
            });
            var thrown = await Assert.ThrowsAsync<IOException>(() => InvokeAsync(context, seed, outbox, timeout.Token));
            Assert.Same(failure, thrown);
            Assert.Equal(2, outbox.AttemptedMessages.Count);
            await AssertStateAsync(database, seed, revoked: false, timeout.Token);
            await using var observer = new TodoDbContext(database.Options<TodoDbContext>());
            Assert.Empty(await observer.OutboxMessages.AsNoTracking().ToListAsync(timeout.Token));
        }

        await using var retry = ConsumerContext(database);
        await InvokeAsync(retry, seed, new OutboxRepository(retry), timeout.Token);

        await AssertStateAsync(database, seed, revoked: true, timeout.Token);
        await AssertEventsAsync(database, seed, timeout.Token);
    }

    [PostgresFact]
    public async Task RevokeAsync_RejectedSignalInsertRollsBackEveryShareAndWorkerRemoval()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var seed = await SeedAsync(database, timeout.Token);
        await using var context = ConsumerContext(database);
        await context.Database.ExecuteSqlRawAsync("""
            ALTER TABLE todo."OutboxMessages" ADD CONSTRAINT reject_revocation_signal
            CHECK ("Type" NOT LIKE '%RealtimeSyncIntegrationEvent%')
            """, timeout.Token);

        await Assert.ThrowsAsync<DbUpdateException>(() =>
            InvokeAsync(context, seed, new OutboxRepository(context), timeout.Token));

        await AssertStateAsync(database, seed, revoked: false, timeout.Token);
        await using var observer = new TodoDbContext(database.Options<TodoDbContext>());
        Assert.Empty(await observer.OutboxMessages.AsNoTracking().ToListAsync(timeout.Token));
    }

    [PostgresFact]
    public async Task RevokeAsync_CancellationBeforeSecondSignalPersistsNoPartialCleanup()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        using var requestCancellation = new CancellationTokenSource();
        var seed = await SeedAsync(database, timeout.Token);
        await using var context = ConsumerContext(database);
        var outbox = new ControlledOutbox(new OutboxRepository(context), attempt =>
        {
            if (attempt == 2) requestCancellation.Cancel();
        });

        var thrown = await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            InvokeAsync(context, seed, outbox, requestCancellation.Token));

        Assert.Equal(requestCancellation.Token, thrown.CancellationToken);
        Assert.Equal(2, outbox.AttemptedMessages.Count);
        await AssertStateAsync(database, seed, revoked: false, timeout.Token);
        await using var observer = new TodoDbContext(database.Options<TodoDbContext>());
        Assert.Empty(await observer.OutboxMessages.AsNoTracking().ToListAsync(timeout.Token));
    }

    [PostgresFact]
    public async Task RevokeAsync_RepeatedEventInFreshContextAddsNoSignalsOrFurtherChanges()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var seed = await SeedAsync(database, timeout.Token);
        await using (var first = ConsumerContext(database))
            await InvokeAsync(first, seed, new OutboxRepository(first), timeout.Token);
        var messages = await AssertEventsAsync(database, seed, timeout.Token);
        await using var retry = ConsumerContext(database);
        var outbox = new ControlledOutbox(new OutboxRepository(retry));

        await InvokeAsync(retry, seed, outbox, timeout.Token);

        Assert.Empty(outbox.AttemptedMessages);
        await AssertStateAsync(database, seed, revoked: true, timeout.Token);
        var afterRetry = await AssertEventsAsync(database, seed, timeout.Token);
        Assert.Equal(messages.Select(message => message.Id).OrderBy(id => id),
            afterRetry.Select(message => message.Id).OrderBy(id => id));
    }

    [PostgresFact]
    public async Task RevokeAsync_FreesLastWorkerSlotForCurrentFriendAndRevokedPeerCannotRejoin()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var seed = await SeedAsync(database, timeout.Token);
        var root = Assert.Single(seed.Rows, row => row.Id == seed.AliceRootId);
        Assert.True(root.IsCapacityFull);
        Assert.Equal(seed.Bob, Assert.Single(root.Workers).UserId);
        await using (var revocation = ConsumerContext(database))
            await InvokeAsync(revocation, seed, new OutboxRepository(revocation), timeout.Token);
        await using (var revokedJoin = new TodoDbContext(database.Options<TodoDbContext>()))
            await Assert.ThrowsAsync<ForbiddenException>(() => JoinAsync(revokedJoin, seed, seed.Bob, timeout.Token));
        await using var join = new TodoDbContext(database.Options<TodoDbContext>());

        await JoinAsync(join, seed, seed.Carol, timeout.Token);

        await using var observer = new TodoDbContext(database.Options<TodoDbContext>());
        var stored = await new TodoRepository(observer).GetByIdWithIncludesAsync(seed.AliceRootId, timeout.Token);
        Assert.NotNull(stored);
        Assert.Equal(seed.Carol, Assert.Single(stored.Workers).UserId);
        Assert.True(stored.IsCapacityFull);
        Assert.Equal(2, stored.RequiredWorkers);
        var notifications = (await observer.OutboxMessages.AsNoTracking().ToListAsync(timeout.Token))
            .Where(message => message.Type == typeof(NotificationEvent).AssemblyQualifiedName)
            .Select(message => JsonSerializer.Deserialize<NotificationEvent>(message.Content)!).ToArray();
        Assert.Equal(seed.Alice, Assert.Single(notifications).UserId);
        Assert.DoesNotContain(notifications, notification => notification.UserId == seed.Bob);
    }

    [PostgresFact]
    public async Task RevokeAsync_TouchesAffectedAggregateSoPreviouslyLoadedEditFailsXminCheck()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var seed = await SeedAsync(database, timeout.Token, futureRootTimestamp: true);
        await using var stale = new TodoDbContext(database.Options<TodoDbContext>());
        var task = await new TodoRepository(stale).GetByIdWithIncludesTrackedAsync(seed.AliceRootId, timeout.Token);
        Assert.NotNull(task);
        await using (var revocation = ConsumerContext(database))
            await InvokeAsync(revocation, seed, new OutboxRepository(revocation), timeout.Token);
        task.UpdateTitle("Synthetic stale edit must not overwrite cleanup", seed.Alice);

        await Assert.ThrowsAsync<DbUpdateConcurrencyException>(() => stale.SaveChangesAsync(timeout.Token));

        await AssertStateAsync(database, seed, revoked: true, timeout.Token);
        await AssertEventsAsync(database, seed, timeout.Token);
        await using var observer = new TodoDbContext(database.Options<TodoDbContext>());
        var stored = await observer.TodoItems.AsNoTracking().SingleAsync(row => row.Id == seed.AliceRootId, timeout.Token);
        Assert.True(stored.UpdatedAt > Assert.Single(seed.Rows, row => row.Id == seed.AliceRootId).UpdatedAt);
    }

    [PostgresFact]
    public async Task RevokeAsync_LegacyFeedAudienceIsResolvedOncePerOwnerAndLookupFailureOnlyNarrowsSignals()
    {
        foreach (var lookupFails in new[] { false, true })
        {
            await using var database = await TemporaryDatabase.CreateAsync();
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
            var seed = await SeedAsync(database, timeout.Token);
            await using (var setup = new TodoDbContext(database.Options<TodoDbContext>()))
            {
                var rows = await setup.TodoItems.Include(task => task.SharedWith).Include(task => task.Workers)
                    .ToListAsync(timeout.Token);
                foreach (var root in rows.Where(task => !task.IsSubtask && seed.AffectedIds.Contains(task.Id)))
                {
                    root.SetPublic(true, root.UserId);
                    foreach (var child in rows.Where(task => task.ParentTodoId == root.Id))
                        child.SyncInheritedFromParent(root, root.UserId);
                }
                await setup.SaveChangesAsync(timeout.Token);
                seed = seed with { Rows = await ReadTodosAsync(setup, timeout.Token) };
            }
            var dynamicFriend = Guid.NewGuid();
            var friendships = Friendships(seed);
            var lookup = friendships.Setup(service => service.GetFriendIdsAsync(
                It.IsAny<Guid>(), It.IsAny<CancellationToken>()));
            if (lookupFails)
                lookup.ThrowsAsync(new IOException("Synthetic legacy feed lookup failure"));
            else
                lookup.ReturnsAsync(new[] { seed.Carol, dynamicFriend });
            await using var context = ConsumerContext(database);

            await InvokeAsync(context, seed, new OutboxRepository(context), timeout.Token, friendships.Object);

            await AssertStateAsync(database, seed, revoked: true, timeout.Token);
            await AssertEventsAsync(database, seed, timeout.Token, lookupFails ? null : dynamicFriend);
            friendships.Verify(service => service.GetFriendIdsAsync(seed.Alice, timeout.Token), Times.Once);
            friendships.Verify(service => service.GetFriendIdsAsync(seed.Bob, timeout.Token), Times.Once);
        }
    }

    [PostgresFact]
    public async Task RevokeAsync_CleansSoftDeletedTaskTreeWithoutChangingDeletionMetadata()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var seed = await SeedAsync(database, timeout.Token);
        await using (var setup = new TodoDbContext(database.Options<TodoDbContext>()))
        {
            var rows = await setup.TodoItems.Where(task => task.UserId == seed.Bob).ToListAsync(timeout.Token);
            Assert.Equal(2, rows.Count);
            foreach (var row in rows)
                row.MarkAsDeleted(seed.Bob);
            await setup.SaveChangesAsync(timeout.Token);
            seed = seed with { Rows = await ReadTodosAsync(setup, timeout.Token) };
        }
        await using var context = ConsumerContext(database);

        await InvokeAsync(context, seed, new OutboxRepository(context), timeout.Token);

        await AssertStateAsync(database, seed, revoked: true, timeout.Token);
        await AssertEventsAsync(database, seed, timeout.Token);
    }

    private static TodoDbContext ConsumerContext(TemporaryDatabase database) =>
        new(new DbContextOptionsBuilder<TodoDbContext>(database.Options<TodoDbContext>())
            .UseQueryTrackingBehavior(QueryTrackingBehavior.NoTracking).Options);

    private static async Task InvokeAsync(TodoDbContext context, Seed seed, IOutboxRepository outbox,
        CancellationToken token, IFriendshipService? friendships = null)
    {
        var services = new ServiceCollection();
        services.AddSingleton<ITodoRepository>(new TodoRepository(context));
        services.AddSingleton<IUnitOfWork>(new TodoUnitOfWork(context));
        services.AddSingleton(outbox);
        services.AddSingleton(friendships ?? Friendships(seed).Object);
        services.AddSingleton<ILogger<FriendshipRemovedEventConsumer>>(NullLogger<FriendshipRemovedEventConsumer>.Instance);
        // Constructor activation keeps the regression executable before the consumer gains its staged-write dependencies.
        using var provider = services.BuildServiceProvider();
        var consumer = ActivatorUtilities.CreateInstance<FriendshipRemovedEventConsumer>(provider);
        await consumer.HandleAsync(new FriendshipRemovedIntegrationEvent(seed.Alice, seed.Bob), token);
    }

    private static async Task JoinAsync(TodoDbContext context, Seed seed, Guid actor, CancellationToken token)
    {
        var current = new Mock<ICurrentUserContext>();
        current.SetupGet(user => user.UserId).Returns(actor);
        current.SetupGet(user => user.Name).Returns("Synthetic current participant");
        var mapper = new MapperConfiguration(configuration => configuration.AddProfile<TodoItemMappingProfile>(),
            NullLoggerFactory.Instance).CreateMapper();
        var handler = new JoinTodoCommandHandler(new TodoRepository(context), new TodoUnitOfWork(context), mapper,
            current.Object, Friendships(seed).Object, new OutboxRepository(context), NullLogger<JoinTodoCommandHandler>.Instance);
        var result = await handler.Handle(new JoinTodoCommand(seed.AliceRootId), token);
        Assert.True(result.IsSuccess);
        Assert.True(result.Value!.IsWorking);
    }

    private static Mock<IFriendshipService> Friendships(Seed seed)
    {
        var friendships = new Mock<IFriendshipService>(MockBehavior.Strict);
        friendships.Setup(service => service.AreFriendsAsync(It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((Guid first, Guid second, CancellationToken _) =>
                (first == seed.Carol && (second == seed.Alice || second == seed.Bob)) ||
                (second == seed.Carol && (first == seed.Alice || first == seed.Bob)));
        friendships.Setup(service => service.GetFriendIdsAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { seed.Carol });
        friendships.Setup(service => service.GetFriendshipsAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { new FriendshipInfo(seed.Carol, DateTime.UtcNow.AddDays(-1)) });
        return friendships;
    }

    private static async Task<Seed> SeedAsync(TemporaryDatabase database, CancellationToken token, bool futureRootTimestamp = false)
    {
        await using var context = new TodoDbContext(database.Options<TodoDbContext>());
        await TodoDatabaseStartup.EnsureReadyAsync(context, NullLogger.Instance, token);
        var alice = Guid.NewGuid(); var bob = Guid.NewGuid(); var carol = Guid.NewGuid();
        var aliceRoot = TodoItem.Create(alice, "Alice private task", "Synthetic root content", Guid.NewGuid(),
            sharedWithUserIds: [bob, carol], requiredWorkers: 2);
        aliceRoot.AddTag("preserve", alice);
        aliceRoot.AddWorker(bob);
        var aliceChild = TodoItem.CreateSubtask(aliceRoot, carol, "Alice child", "Synthetic child content");
        aliceChild.AddWorker(alice); aliceChild.AddWorker(bob); aliceChild.AddWorker(carol);
        var bobRoot = TodoItem.Create(bob, "Bob private task", sharedWithUserIds: [alice, carol], requiredWorkers: 3);
        bobRoot.AddWorker(alice); bobRoot.AddWorker(carol);
        var bobChild = TodoItem.CreateSubtask(bobRoot, alice, "Bob child", null);
        bobChild.AddWorker(bob); bobChild.AddWorker(alice); bobChild.AddWorker(carol);
        var historical = TodoItem.Create(alice, "Historical worker without share", sharedWithUserIds: [carol]);
        historical.AddWorker(bob); historical.AddWorker(carol);
        var unrelatedOwner = TodoItem.Create(carol, "Carol task unchanged", sharedWithUserIds: [alice, bob]);
        unrelatedOwner.AddWorker(alice); unrelatedOwner.AddWorker(bob);
        var unrelatedPeer = TodoItem.Create(alice, "Unrelated peer unchanged", sharedWithUserIds: [carol]);
        unrelatedPeer.AddWorker(carol);
        if (futureRootTimestamp)
        {
            RetentionTestKit.Set(aliceRoot, nameof(TodoItem.UpdatedAt), DateTime.UtcNow.AddDays(1));
            RetentionTestKit.Set(aliceRoot, nameof(TodoItem.UpdatedBy), alice);
        }
        context.TodoItems.AddRange(aliceRoot, aliceChild, bobRoot, bobChild, historical, unrelatedOwner, unrelatedPeer);
        context.UserTodoViewPreferences.AddRange(
            new UserTodoViewPreference { ViewerId = bob, TodoItemId = aliceRoot.Id, HiddenByViewer = true, ViewerCategoryId = Guid.NewGuid() },
            new UserTodoViewPreference { ViewerId = carol, TodoItemId = aliceRoot.Id, CompletedByViewer = true, CompletedByViewerAt = DateTime.UtcNow });
        await context.SaveChangesAsync(token);
        return new Seed(alice, bob, carol, aliceRoot.Id, historical.Id,
            [aliceRoot.Id, aliceChild.Id, bobRoot.Id, bobChild.Id, historical.Id],
            await ReadTodosAsync(context, token), await ReadPreferencesAsync(context, token));
    }

    private static Task<List<TodoItem>> ReadTodosAsync(TodoDbContext context, CancellationToken token) =>
        context.TodoItems.IgnoreQueryFilters().AsNoTracking().AsSplitQuery()
            .Include(task => task.Tags).Include(task => task.SharedWith).Include(task => task.Workers).ToListAsync(token);

    private static async Task<string> ReadPreferencesAsync(TodoDbContext context, CancellationToken token) =>
        JsonSerializer.Serialize(await context.UserTodoViewPreferences.AsNoTracking()
            .OrderBy(preference => preference.TodoItemId).ThenBy(preference => preference.ViewerId).ToListAsync(token));

    private static async Task AssertStateAsync(TemporaryDatabase database, Seed seed, bool revoked, CancellationToken token)
    {
        await using var observer = new TodoDbContext(database.Options<TodoDbContext>());
        var rows = await ReadTodosAsync(observer, token);
        Assert.Equal(seed.Rows.Count, rows.Count);
        foreach (var expected in seed.Rows)
        {
            var actual = Assert.Single(rows, row => row.Id == expected.Id);
            var changed = revoked && seed.AffectedIds.Contains(expected.Id);
            var peer = expected.UserId == seed.Alice ? seed.Bob : seed.Alice;
            Assert.Equal((expected.UserId, expected.CreatedByUserId, expected.ParentTodoId, expected.Title, expected.Description),
                (actual.UserId, actual.CreatedByUserId, actual.ParentTodoId, actual.Title, actual.Description));
            Assert.Equal((expected.Status, expected.Priority, expected.CategoryId, expected.RequiredWorkers, expected.IsPublic, expected.AllFriendsSnapshotAt),
                (actual.Status, actual.Priority, actual.CategoryId, actual.RequiredWorkers, actual.IsPublic, actual.AllFriendsSnapshotAt));
            Assert.Equal((expected.DueDateStart, expected.DueDate, expected.ExpectedDate, expected.ActualDate, expected.Hidden, expected.CompletedAt),
                (actual.DueDateStart, actual.DueDate, actual.ExpectedDate, actual.ActualDate, actual.Hidden, actual.CompletedAt));
            Assert.Equal((expected.CreatedAt, expected.CreatedBy, expected.IsDeleted, expected.DeletedAt, expected.DeletedBy),
                (actual.CreatedAt, actual.CreatedBy, actual.IsDeleted, actual.DeletedAt, actual.DeletedBy));
            Assert.Equal(expected.Tags.OrderBy(tag => tag.Id).Select(tag => (tag.Id, tag.Name)),
                actual.Tags.OrderBy(tag => tag.Id).Select(tag => (tag.Id, tag.Name)));
            Assert.Equal(expected.SharedWith.Where(share => !changed || share.SharedWithUserId != peer)
                    .OrderBy(share => share.SharedWithUserId).Select(share => (share.TodoItemId, share.SharedWithUserId)),
                actual.SharedWith.OrderBy(share => share.SharedWithUserId).Select(share => (share.TodoItemId, share.SharedWithUserId)));
            Assert.Equal(expected.Workers.Where(worker => !changed || worker.UserId != peer)
                    .OrderBy(worker => worker.UserId).Select(worker => (worker.TodoItemId, worker.UserId, worker.JoinedAt)),
                actual.Workers.OrderBy(worker => worker.UserId).Select(worker => (worker.TodoItemId, worker.UserId, worker.JoinedAt)));
            if (!changed)
                Assert.Equal((expected.UpdatedAt, expected.UpdatedBy), (actual.UpdatedAt, actual.UpdatedBy));
        }
        Assert.Equal(seed.Preferences, await ReadPreferencesAsync(observer, token));
    }

    private static async Task<List<OutboxMessage>> AssertEventsAsync(TemporaryDatabase database, Seed seed,
        CancellationToken token, Guid? dynamicFriend = null)
    {
        await using var observer = new TodoDbContext(database.Options<TodoDbContext>());
        var messages = await observer.OutboxMessages.AsNoTracking().ToListAsync(token);
        Assert.Equal(seed.AffectedIds.Count, messages.Count);
        Assert.All(messages, message =>
        {
            Assert.Equal(typeof(RealtimeSyncIntegrationEvent).AssemblyQualifiedName, message.Type);
            Assert.Equal(OutboxMessageStatus.Pending, message.Status);
            using var document = JsonDocument.Parse(message.Content);
            Assert.All(document.RootElement.EnumerateObject(), property =>
                Assert.Contains(property.Name, new[] { "Id", "OccurredOn", "Action", "EntityId", "BranchTaskId", "ActorId", "AudienceUserIds" }));
        });
        var events = messages.Select(message => JsonSerializer.Deserialize<RealtimeSyncIntegrationEvent>(message.Content)!).ToArray();
        Assert.Equal(seed.AffectedIds.OrderBy(id => id), events.Select(signal => signal.EntityId).OrderBy(id => id));
        foreach (var signal in events)
        {
            var task = Assert.Single(seed.Rows, row => row.Id == signal.EntityId);
            Assert.Equal(Guid.Empty, signal.ActorId);
            Assert.Equal(task.ParentTodoId ?? task.Id, signal.BranchTaskId);
            Assert.Equal(task.IsSubtask ? RealtimeSyncAction.SubtaskChanged : RealtimeSyncAction.TaskUpdated, signal.Action);
            if (task.IsSubtask)
                Assert.Empty(signal.AudienceUserIds);
            else
                Assert.Equal(new[] { seed.Alice, seed.Bob, seed.Carol }
                    .Concat(dynamicFriend.HasValue ? new[] { dynamicFriend.Value } : Array.Empty<Guid>()).OrderBy(id => id),
                    signal.AudienceUserIds.OrderBy(id => id));
        }
        return messages;
    }

    private sealed record Seed(Guid Alice, Guid Bob, Guid Carol, Guid AliceRootId, Guid HistoricalId,
        IReadOnlyList<Guid> AffectedIds, IReadOnlyList<TodoItem> Rows, string Preferences);

    private sealed class ControlledOutbox(IOutboxRepository inner, Action<int>? beforeWrite = null) : IOutboxRepository
    {
        public List<OutboxMessage> AttemptedMessages { get; } = [];
        public int ImmediateWrites { get; private set; }
        public Task StageAsync(OutboxMessage message, CancellationToken cancellationToken = default)
        {
            BeforeWrite(message);
            return inner.StageAsync(message, cancellationToken);
        }
        public Task AddAsync(OutboxMessage message, CancellationToken cancellationToken = default)
        {
            ImmediateWrites++;
            BeforeWrite(message);
            return inner.AddAsync(message, cancellationToken);
        }
        private void BeforeWrite(OutboxMessage message)
        {
            AttemptedMessages.Add(message);
            beforeWrite?.Invoke(AttemptedMessages.Count);
        }
        public Task<IReadOnlyList<OutboxMessage>> GetPendingMessagesAsync(int batchSize, CancellationToken cancellationToken = default) =>
            inner.GetPendingMessagesAsync(batchSize, cancellationToken);
        public Task UpdateAsync(OutboxMessage message, CancellationToken cancellationToken = default) => inner.UpdateAsync(message, cancellationToken);
        public Task DeleteProcessedMessagesAsync(DateTime olderThan, CancellationToken cancellationToken = default) =>
            inner.DeleteProcessedMessagesAsync(olderThan, cancellationToken);
    }
}
