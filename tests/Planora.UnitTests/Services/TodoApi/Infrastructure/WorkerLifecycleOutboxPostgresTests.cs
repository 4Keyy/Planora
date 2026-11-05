using System.Text.Json;
using AutoMapper;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Planora.BuildingBlocks.Application.Context;
using Planora.BuildingBlocks.Application.Messaging.Events;
using Planora.BuildingBlocks.Application.Outbox;
using Planora.Todo.Application.DTOs;
using Planora.Todo.Application.Features.Todos.Commands.JoinTodo;
using Planora.Todo.Application.Features.Todos.Commands.LeaveTodo;
using Planora.Todo.Application.Services;
using Planora.Todo.Domain.Entities;
using Planora.Todo.Domain.Enums;
using Planora.Todo.Domain.Repositories;
using Planora.Todo.Infrastructure.Persistence;
using Planora.Todo.Infrastructure.Persistence.Repositories;
using Planora.UnitTests.BuildingBlocks.Retention.Postgres;

namespace Planora.UnitTests.Services.TodoApi.Infrastructure;

public sealed class WorkerLifecycleOutboxPostgresTests
{
    [PostgresFact]
    public async Task JoinRootAsync_LastRecipientFailureRollsBackWorkerAndEveryEvent()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var seed = await SeedAsync(database, actorIsWorker: false, timeout.Token);
        await using var context = new TodoDbContext(database.Options<TodoDbContext>());
        var failure = new IOException("Synthetic last worker notification failure");
        var outbox = new ControlledOutbox(new OutboxRepository(context), attempt =>
        {
            if (attempt == 4) throw failure;
        });

        var thrown = await Assert.ThrowsAsync<IOException>(() =>
            InvokeAsync(context, seed, outbox, join: true, subtask: false, timeout.Token));

        Assert.Same(failure, thrown);
        Assert.Equal(4, outbox.AttemptedMessages.Count);
        await AssertRolledBackAsync(database, seed, timeout.Token);
    }

    [PostgresFact]
    public async Task JoinRootAsync_RejectedNotificationInsertRollsBackWorkerActivityAndFeed()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var seed = await SeedAsync(database, actorIsWorker: false, timeout.Token);
        await using var context = new TodoDbContext(database.Options<TodoDbContext>());
        await context.Database.ExecuteSqlRawAsync("""
            ALTER TABLE todo."OutboxMessages" ADD CONSTRAINT reject_notification
            CHECK ("Type" NOT LIKE '%NotificationEvent%')
            """, timeout.Token);
        var outbox = new ControlledOutbox(new OutboxRepository(context));

        await Assert.ThrowsAsync<DbUpdateException>(() =>
            InvokeAsync(context, seed, outbox, join: true, subtask: false, timeout.Token));

        await AssertRolledBackAsync(database, seed, timeout.Token);
    }

    [PostgresFact]
    public async Task LeaveRootAsync_CancellationBeforeSecondEventRollsBackWorkerRemovalAndActivity()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        using var requestCancellation = new CancellationTokenSource();
        var seed = await SeedAsync(database, actorIsWorker: true, timeout.Token);
        await using var context = new TodoDbContext(database.Options<TodoDbContext>());
        var outbox = new ControlledOutbox(new OutboxRepository(context), attempt =>
        {
            if (attempt == 2) requestCancellation.Cancel();
        });

        var thrown = await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            InvokeAsync(context, seed, outbox, join: false, subtask: false, requestCancellation.Token));

        Assert.Equal(requestCancellation.Token, thrown.CancellationToken);
        Assert.Equal(2, outbox.AttemptedMessages.Count);
        await AssertRolledBackAsync(database, seed, timeout.Token);
    }

    [PostgresFact]
    public async Task SubtaskMutationsAsync_RejectedBranchSignalRollsBackBothJoinAndLeave()
    {
        foreach (var join in new[] { true, false })
        {
            await using var database = await TemporaryDatabase.CreateAsync();
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
            var seed = await SeedAsync(database, actorIsWorker: !join, timeout.Token);
            await using var context = new TodoDbContext(database.Options<TodoDbContext>());
            await context.Database.ExecuteSqlRawAsync("""
                ALTER TABLE todo."OutboxMessages" ADD CONSTRAINT reject_branch
                CHECK ("Type" NOT LIKE '%RealtimeSyncIntegrationEvent%')
                """, timeout.Token);
            var outbox = new ControlledOutbox(new OutboxRepository(context));

            await Assert.ThrowsAsync<DbUpdateException>(() =>
                InvokeAsync(context, seed, outbox, join, subtask: true, timeout.Token));

            Assert.Single(outbox.AttemptedMessages);
            await AssertRolledBackAsync(database, seed, timeout.Token);
        }
    }

    [PostgresFact]
    public async Task JoinRootAsync_CommitsCompleteFanoutAndFreshContextRetryAddsNothing()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var seed = await SeedAsync(database, actorIsWorker: false, timeout.Token);
        await using var context = new TodoDbContext(database.Options<TodoDbContext>());
        var outbox = new ControlledOutbox(new OutboxRepository(context));

        await InvokeAsync(context, seed, outbox, join: true, subtask: false, timeout.Token);

        await using var observer = new TodoDbContext(database.Options<TodoDbContext>());
        await AssertStoredStateAsync(observer, seed, seed.Root.Id, joined: true, timeout.Token);
        var firstMessages = await AssertEventsAsync(observer, seed, join: true, subtask: false, timeout.Token);
        Assert.Equal(4, outbox.AttemptedMessages.Count);
        await using var retryContext = new TodoDbContext(database.Options<TodoDbContext>());
        var retryOutbox = new ControlledOutbox(new OutboxRepository(retryContext));

        await InvokeAsync(retryContext, seed, retryOutbox, join: true, subtask: false, timeout.Token);

        Assert.Empty(retryOutbox.AttemptedMessages);
        await using var retryObserver = new TodoDbContext(database.Options<TodoDbContext>());
        await AssertStoredStateAsync(retryObserver, seed, seed.Root.Id, joined: true, timeout.Token);
        var retryMessages = await AssertEventsAsync(retryObserver, seed, join: true, subtask: false, timeout.Token);
        Assert.Equal(firstMessages.Select(message => message.Id).OrderBy(id => id),
            retryMessages.Select(message => message.Id).OrderBy(id => id));
    }

    [PostgresFact]
    public Task LeaveRootAsync_CommitsRemovalActivityAndFeedWithoutContentNotifications() =>
        AssertSuccessAsync(join: false, subtask: false);

    [PostgresFact]
    public Task JoinSubtaskAsync_CommitsWorkerAndOnlyParentBranchSignal() =>
        AssertSuccessAsync(join: true, subtask: true);

    [PostgresFact]
    public Task LeaveSubtaskAsync_CommitsWorkerRemovalAndOnlyParentBranchSignal() =>
        AssertSuccessAsync(join: false, subtask: true);

    [PostgresFact]
    public Task JoinRootAsync_DoesNotTurnCommittedMutationIntoCountLookupFailure() =>
        AssertIndependentOfCountAsync(join: true);

    [PostgresFact]
    public Task LeaveRootAsync_DoesNotTurnCommittedMutationIntoCountLookupFailure() =>
        AssertIndependentOfCountAsync(join: false);

    private static async Task AssertSuccessAsync(bool join, bool subtask)
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var seed = await SeedAsync(database, actorIsWorker: !join, timeout.Token);
        await using var context = new TodoDbContext(database.Options<TodoDbContext>());
        var outbox = new ControlledOutbox(new OutboxRepository(context));

        await InvokeAsync(context, seed, outbox, join, subtask, timeout.Token);

        await using var observer = new TodoDbContext(database.Options<TodoDbContext>());
        await AssertStoredStateAsync(observer, seed, subtask ? seed.Subtask.Id : seed.Root.Id, join, timeout.Token);
        var messages = await AssertEventsAsync(observer, seed, join, subtask, timeout.Token);
        Assert.Equal(messages.Count, outbox.AttemptedMessages.Count);
    }

    private static async Task AssertIndependentOfCountAsync(bool join)
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var seed = await SeedAsync(database, actorIsWorker: !join, timeout.Token);
        await using var context = new TodoDbContext(database.Options<TodoDbContext>());
        var actualRepository = new TodoRepository(context);
        var repository = new Mock<ITodoRepository>(MockBehavior.Strict);
        repository.Setup(repo => repo.GetByIdWithIncludesTrackedAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()))
            .Returns((Guid id, CancellationToken token) => actualRepository.GetByIdWithIncludesTrackedAsync(id, token));
        repository.Setup(repo => repo.GetActiveWorkerTaskCountAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new IOException("Synthetic diagnostic count failure"));
        var outbox = new ControlledOutbox(new OutboxRepository(context));

        var error = await Record.ExceptionAsync(() =>
            InvokeAsync(context, seed, outbox, join, subtask: false, timeout.Token, repository.Object));

        await using var observer = new TodoDbContext(database.Options<TodoDbContext>());
        await AssertStoredStateAsync(observer, seed, seed.Root.Id, join, timeout.Token);
        await AssertEventsAsync(observer, seed, join, subtask: false, timeout.Token);
        Assert.Null(error);
        repository.Verify(repo => repo.GetActiveWorkerTaskCountAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    private static async Task InvokeAsync(
        TodoDbContext context, Seed seed, IOutboxRepository outbox, bool join, bool subtask,
        CancellationToken token, ITodoRepository? repository = null)
    {
        var currentUser = new Mock<ICurrentUserContext>();
        currentUser.SetupGet(user => user.UserId).Returns(seed.ActorId);
        currentUser.SetupGet(user => user.Name).Returns("Audit Worker");
        var friendships = new Mock<IFriendshipService>();
        friendships.Setup(service => service.AreFriendsAsync(
                seed.ActorId, seed.Root.UserId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);
        friendships.Setup(service => service.GetFriendshipsAsync(seed.Root.UserId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[]
            {
                new FriendshipInfo(seed.ActorId, DateTime.UtcNow.AddDays(-1)),
                new FriendshipInfo(seed.OtherFriendId, DateTime.UtcNow.AddDays(-1)),
            });
        var target = subtask ? seed.Subtask : seed.Root;
        repository ??= new TodoRepository(context);
        if (join)
        {
            var mapper = new MapperConfiguration(
                configuration => configuration.AddProfile<TodoItemMappingProfile>(),
                NullLoggerFactory.Instance).CreateMapper();
            var handler = new JoinTodoCommandHandler(
                repository, new TodoUnitOfWork(context), mapper, currentUser.Object,
                friendships.Object, outbox, NullLogger<JoinTodoCommandHandler>.Instance);
            var result = await handler.Handle(new JoinTodoCommand(target.Id), token);
            Assert.True(result.IsSuccess);
            Assert.Equal(target.Id, result.Value!.Id);
            Assert.True(result.Value.IsWorking);
            Assert.Equal(target.RequiredWorkers, result.Value.RequiredWorkers);
            var expectedWorkers = target.Workers.Select(worker => worker.UserId).Append(seed.ActorId).Distinct().OrderBy(id => id);
            Assert.Equal(expectedWorkers, result.Value.WorkerUserIds.OrderBy(id => id));
            Assert.Equal(expectedWorkers.Count(), result.Value.WorkerCount);
        }
        else
        {
            var handler = new LeaveTodoCommandHandler(
                repository, new TodoUnitOfWork(context), currentUser.Object, outbox,
                friendships.Object, NullLogger<LeaveTodoCommandHandler>.Instance);
            var result = await handler.Handle(new LeaveTodoCommand(target.Id), token);
            Assert.True(result.IsSuccess);
        }
    }

    private static async Task<Seed> SeedAsync(TemporaryDatabase database, bool actorIsWorker, CancellationToken token)
    {
        await using var context = new TodoDbContext(database.Options<TodoDbContext>());
        await TodoDatabaseStartup.EnsureReadyAsync(context, NullLogger.Instance, token);
        var ownerId = Guid.NewGuid();
        var actorId = Guid.NewGuid();
        var otherFriendId = Guid.NewGuid();
        var formerFriendId = Guid.NewGuid();
        var dueStart = DateTime.UtcNow.AddDays(1);
        var root = TodoItem.Create(
            ownerId, "Atomic workers", "Synthetic root description", Guid.NewGuid(),
            dueDate: dueStart.AddDays(2), expectedDate: dueStart.AddDays(1),
            priority: TodoPriority.High, sharedWithUserIds: new[] { actorId, otherFriendId, formerFriendId },
            requiredWorkers: 3, dueDateStart: dueStart);
        root.AddTag("root", ownerId);
        root.AddWorker(otherFriendId);
        var subtask = TodoItem.CreateSubtask(root, otherFriendId, "Atomic subtask workers", "Synthetic subtask description");
        subtask.AddTag("subtask", ownerId);
        subtask.AddWorker(ownerId);
        subtask.AddWorker(otherFriendId);
        if (actorIsWorker)
        {
            root.AddWorker(actorId);
            subtask.AddWorker(actorId);
        }
        var unrelated = TodoItem.Create(
            ownerId, "Unrelated workers", "Synthetic unrelated description", Guid.NewGuid(),
            priority: TodoPriority.Low, sharedWithUserIds: new[] { actorId }, requiredWorkers: 2);
        unrelated.AddTag("unrelated", ownerId);
        unrelated.AddWorker(actorId);
        context.TodoItems.AddRange(root, subtask, unrelated);
        await context.SaveChangesAsync(token);
        var rows = await ReadTodosAsync(context, token);
        return new Seed(
            Assert.Single(rows, item => item.Id == root.Id),
            Assert.Single(rows, item => item.Id == subtask.Id),
            Assert.Single(rows, item => item.Id == unrelated.Id),
            actorId, otherFriendId, formerFriendId);
    }

    private static Task<List<TodoItem>> ReadTodosAsync(TodoDbContext context, CancellationToken token) =>
        context.TodoItems.IgnoreQueryFilters().AsNoTracking().AsSplitQuery()
            .Include(task => task.Tags)
            .Include(task => task.SharedWith)
            .Include(task => task.Workers)
            .ToListAsync(token);

    private static async Task AssertRolledBackAsync(TemporaryDatabase database, Seed seed, CancellationToken token)
    {
        await using var observer = new TodoDbContext(database.Options<TodoDbContext>());
        await AssertStoredStateAsync(observer, seed, changedId: null, joined: false, token);
        Assert.Empty(await observer.OutboxMessages.AsNoTracking().ToListAsync(token));
    }

    private static async Task AssertStoredStateAsync(
        TodoDbContext observer, Seed seed, Guid? changedId, bool joined, CancellationToken token)
    {
        var rows = await ReadTodosAsync(observer, token);
        var expectedRows = new[] { seed.Root, seed.Subtask, seed.Unrelated };
        Assert.Equal(expectedRows.Length, rows.Count);
        foreach (var expected in expectedRows)
        {
            var actual = Assert.Single(rows, row => row.Id == expected.Id);
            var changed = expected.Id == changedId;
            AssertContentUnchanged(expected, actual);
            if (changed && joined)
            {
                Assert.NotNull(actual.UpdatedAt);
                Assert.Equal(seed.ActorId, actual.UpdatedBy);
            }
            else
            {
                Assert.Equal((expected.UpdatedAt, expected.UpdatedBy), (actual.UpdatedAt, actual.UpdatedBy));
            }
            Assert.Equal(expected.Workers.Where(worker => !changed || worker.UserId != seed.ActorId)
                    .OrderBy(worker => worker.UserId).Select(worker => (worker.TodoItemId, worker.UserId, worker.JoinedAt)),
                actual.Workers.Where(worker => !changed || worker.UserId != seed.ActorId)
                    .OrderBy(worker => worker.UserId).Select(worker => (worker.TodoItemId, worker.UserId, worker.JoinedAt)));
            if (changed)
            {
                if (joined)
                {
                    var actor = Assert.Single(actual.Workers, worker => worker.UserId == seed.ActorId);
                    Assert.Equal(expected.Id, actor.TodoItemId);
                    Assert.NotEqual(default, actor.JoinedAt);
                }
                else
                {
                    Assert.DoesNotContain(actual.Workers, worker => worker.UserId == seed.ActorId);
                }
            }
        }
        var expectedCount = expectedRows.Sum(row => row.Workers.Count) + (changedId.HasValue ? joined ? 1 : -1 : 0);
        Assert.Equal(expectedCount, await observer.Set<TodoItemWorker>().AsNoTracking().CountAsync(token));
        Assert.Equal(expectedRows.Sum(row => row.SharedWith.Count),
            await observer.TodoItemShares.AsNoTracking().CountAsync(token));
    }

    private static void AssertContentUnchanged(TodoItem expected, TodoItem actual)
    {
        Assert.Equal((expected.Id, expected.UserId, expected.CreatedByUserId, expected.ParentTodoId),
            (actual.Id, actual.UserId, actual.CreatedByUserId, actual.ParentTodoId));
        Assert.Equal((expected.Title, expected.Description, expected.Priority, expected.CategoryId),
            (actual.Title, actual.Description, actual.Priority, actual.CategoryId));
        Assert.Equal((expected.Status, expected.CompletedAt, expected.ActualDate, expected.Hidden),
            (actual.Status, actual.CompletedAt, actual.ActualDate, actual.Hidden));
        Assert.Equal((expected.DueDateStart, expected.DueDate, expected.ExpectedDate),
            (actual.DueDateStart, actual.DueDate, actual.ExpectedDate));
        Assert.Equal((expected.IsPublic, expected.AllFriendsSnapshotAt, expected.RequiredWorkers),
            (actual.IsPublic, actual.AllFriendsSnapshotAt, actual.RequiredWorkers));
        Assert.Equal((expected.CreatedAt, expected.CreatedBy, expected.IsDeleted, expected.DeletedAt, expected.DeletedBy),
            (actual.CreatedAt, actual.CreatedBy, actual.IsDeleted, actual.DeletedAt, actual.DeletedBy));
        Assert.Equal(expected.Tags.OrderBy(tag => tag.Id).Select(tag => (tag.Id, tag.Name)),
            actual.Tags.OrderBy(tag => tag.Id).Select(tag => (tag.Id, tag.Name)));
        Assert.Equal(expected.SharedWith.OrderBy(share => share.SharedWithUserId)
                .Select(share => (share.TodoItemId, share.SharedWithUserId)),
            actual.SharedWith.OrderBy(share => share.SharedWithUserId)
                .Select(share => (share.TodoItemId, share.SharedWithUserId)));
    }

    private static async Task<List<OutboxMessage>> AssertEventsAsync(
        TodoDbContext observer, Seed seed, bool join, bool subtask, CancellationToken token)
    {
        var messages = await observer.OutboxMessages.AsNoTracking().ToListAsync(token);
        Assert.Equal(subtask ? 1 : join ? 4 : 2, messages.Count);
        Assert.All(messages, message => Assert.Equal(OutboxMessageStatus.Pending, message.Status));
        var sync = JsonSerializer.Deserialize<RealtimeSyncIntegrationEvent>(
            Assert.Single(messages, message => message.Type == typeof(RealtimeSyncIntegrationEvent).AssemblyQualifiedName).Content)!;
        Assert.Equal(subtask ? seed.Subtask.Id : seed.Root.Id, sync.EntityId);
        Assert.Equal(seed.Root.Id, sync.BranchTaskId);
        Assert.Equal(seed.ActorId, sync.ActorId);
        Assert.Equal(subtask ? RealtimeSyncAction.SubtaskChanged : RealtimeSyncAction.TaskUpdated, sync.Action);
        if (subtask)
        {
            Assert.Empty(sync.AudienceUserIds);
            return messages;
        }

        Assert.Equal(new[] { seed.Root.UserId, seed.ActorId, seed.OtherFriendId, seed.FormerFriendId }.OrderBy(id => id),
            sync.AudienceUserIds.OrderBy(id => id));
        var activity = JsonSerializer.Deserialize<TaskActivityIntegrationEvent>(
            Assert.Single(messages, message => message.Type == typeof(TaskActivityIntegrationEvent).AssemblyQualifiedName).Content)!;
        Assert.Equal(seed.Root.Id, activity.TaskId);
        Assert.Equal(seed.ActorId, activity.ActorId);
        Assert.Equal("Audit Worker", activity.ActorName);
        Assert.Equal(join ? TaskActivityType.StartedWorking : TaskActivityType.Left, activity.ActivityType);
        Assert.Null(activity.Detail);
        if (join)
        {
            var notifications = messages.Where(message => message.Type == typeof(NotificationEvent).AssemblyQualifiedName)
                .Select(message => JsonSerializer.Deserialize<NotificationEvent>(message.Content)!).ToArray();
            Assert.Equal(new[] { seed.Root.UserId, seed.OtherFriendId }.OrderBy(id => id),
                notifications.Select(notification => notification.UserId).OrderBy(id => id));
            Assert.All(notifications, notification =>
            {
                Assert.Equal(seed.Root.Id, notification.TaskId);
                Assert.Equal(seed.ActorId, notification.ActorId);
                Assert.Equal(NotificationType.TaskStarted, notification.Type);
                Assert.Equal("Task picked up", notification.Title);
                Assert.Equal("Audit Worker took “Atomic workers” into work", notification.Message);
                Assert.NotEqual(seed.ActorId, notification.UserId);
                Assert.NotEqual(seed.FormerFriendId, notification.UserId);
                Assert.NotEqual(Guid.Empty, notification.UserId);
            });
        }
        return messages;
    }

    private sealed record Seed(
        TodoItem Root, TodoItem Subtask, TodoItem Unrelated, Guid ActorId, Guid OtherFriendId, Guid FormerFriendId);

    private sealed class ControlledOutbox(IOutboxRepository inner, Action<int>? beforeWrite = null) : IOutboxRepository
    {
        public List<OutboxMessage> AttemptedMessages { get; } = [];

        public Task StageAsync(OutboxMessage message, CancellationToken cancellationToken = default)
        {
            BeforeWrite(message);
            return inner.StageAsync(message, cancellationToken);
        }

        public Task AddAsync(OutboxMessage message, CancellationToken cancellationToken = default)
        {
            BeforeWrite(message);
            return inner.AddAsync(message, cancellationToken);
        }

        private void BeforeWrite(OutboxMessage message)
        {
            AttemptedMessages.Add(message);
            beforeWrite?.Invoke(AttemptedMessages.Count);
        }

        public Task<IReadOnlyList<OutboxMessage>> GetPendingMessagesAsync(
            int batchSize, CancellationToken cancellationToken = default) =>
            inner.GetPendingMessagesAsync(batchSize, cancellationToken);

        public Task UpdateAsync(OutboxMessage message, CancellationToken cancellationToken = default) =>
            inner.UpdateAsync(message, cancellationToken);

        public Task DeleteProcessedMessagesAsync(DateTime olderThan, CancellationToken cancellationToken = default) =>
            inner.DeleteProcessedMessagesAsync(olderThan, cancellationToken);
    }
}
