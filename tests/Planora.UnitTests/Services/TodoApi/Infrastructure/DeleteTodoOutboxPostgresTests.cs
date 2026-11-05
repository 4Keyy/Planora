using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Planora.BuildingBlocks.Application.Context;
using Planora.BuildingBlocks.Application.Messaging.Events;
using Planora.BuildingBlocks.Application.Outbox;
using Planora.Todo.Application.Features.Todos.Commands.DeleteTodo;
using Planora.Todo.Application.Services;
using Planora.Todo.Domain.Entities;
using Planora.Todo.Domain.Enums;
using Planora.Todo.Infrastructure.Persistence;
using Planora.Todo.Infrastructure.Persistence.Repositories;
using Planora.UnitTests.BuildingBlocks.Retention.Postgres;

namespace Planora.UnitTests.Services.TodoApi.Infrastructure;

public sealed class DeleteTodoOutboxPostgresTests
{
    [PostgresFact]
    public Task DeleteRootAsync_SecondEventFailureLeavesTreeAliveAndNoEvents() =>
        AssertSecondEventFailureAsync(deleteSubtask: false);

    [PostgresFact]
    public Task DeleteSubtaskAsync_SecondEventFailureLeavesParentSiblingAndTargetAlive() =>
        AssertSecondEventFailureAsync(deleteSubtask: true);

    [PostgresFact]
    public Task DeleteRootAsync_RejectedFeedInsertRollsBackTreeAndDeletionFact() =>
        AssertRejectedFeedAsync(deleteSubtask: false);

    [PostgresFact]
    public Task DeleteSubtaskAsync_RejectedFeedInsertRollsBackTargetAndDeletionFact() =>
        AssertRejectedFeedAsync(deleteSubtask: true);

    [PostgresFact]
    public Task DeleteRootAsync_CommitsTreeDeletionFactAndCompleteFeedAudience() =>
        AssertSuccessAsync(deleteSubtask: false);

    [PostgresFact]
    public Task DeleteSubtaskAsync_ByCreatorCommitsOnlyTargetDeletionAndParentBranchSignal() =>
        AssertSuccessAsync(deleteSubtask: true);

    private static async Task AssertSecondEventFailureAsync(bool deleteSubtask)
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var seed = await SeedTreeAsync(database, timeout.Token);
        await using var context = new TodoDbContext(database.Options<TodoDbContext>());
        var failure = new IOException("Synthetic second deletion event failure");
        var outbox = new ControlledOutbox(new OutboxRepository(context), failure);
        var actorId = deleteSubtask ? seed.CreatorId : seed.Parent.UserId;
        var targetId = deleteSubtask ? seed.Target.Id : seed.Parent.Id;
        var handler = CreateHandler(context, seed, actorId, outbox);

        var thrown = await Assert.ThrowsAsync<IOException>(() =>
            handler.Handle(new DeleteTodoCommand(targetId), timeout.Token));

        Assert.Same(failure, thrown);
        AssertEventAttempts(outbox, deleteSubtask);
        await using var observer = new TodoDbContext(database.Options<TodoDbContext>());
        await AssertStoredRowsAsync(observer, seed, Array.Empty<Guid>(), actorId, timeout.Token);
        Assert.Empty(await observer.OutboxMessages.AsNoTracking().ToListAsync(timeout.Token));
    }

    private static async Task AssertRejectedFeedAsync(bool deleteSubtask)
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var seed = await SeedTreeAsync(database, timeout.Token);
        await using var context = new TodoDbContext(database.Options<TodoDbContext>());
        await context.Database.ExecuteSqlRawAsync("""
            ALTER TABLE todo."OutboxMessages" ADD CONSTRAINT reject_feed
            CHECK ("Type" NOT LIKE '%RealtimeSyncIntegrationEvent%')
            """, timeout.Token);
        var outbox = new ControlledOutbox(new OutboxRepository(context));
        var actorId = deleteSubtask ? seed.CreatorId : seed.Parent.UserId;
        var targetId = deleteSubtask ? seed.Target.Id : seed.Parent.Id;
        var handler = CreateHandler(context, seed, actorId, outbox);

        await Assert.ThrowsAsync<DbUpdateException>(() =>
            handler.Handle(new DeleteTodoCommand(targetId), timeout.Token));

        AssertEventAttempts(outbox, deleteSubtask);
        await using var observer = new TodoDbContext(database.Options<TodoDbContext>());
        await AssertStoredRowsAsync(observer, seed, Array.Empty<Guid>(), actorId, timeout.Token);
        Assert.Empty(await observer.OutboxMessages.AsNoTracking().ToListAsync(timeout.Token));
    }

    private static async Task AssertSuccessAsync(bool deleteSubtask)
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var seed = await SeedTreeAsync(database, timeout.Token);
        await using var context = new TodoDbContext(database.Options<TodoDbContext>());
        var outbox = new ControlledOutbox(new OutboxRepository(context));
        var actorId = deleteSubtask ? seed.CreatorId : seed.Parent.UserId;
        var targetId = deleteSubtask ? seed.Target.Id : seed.Parent.Id;
        var handler = CreateHandler(context, seed, actorId, outbox);

        var result = await handler.Handle(new DeleteTodoCommand(targetId), timeout.Token);

        Assert.True(result.IsSuccess);
        AssertEventAttempts(outbox, deleteSubtask);
        await using var observer = new TodoDbContext(database.Options<TodoDbContext>());
        var deletedIds = deleteSubtask
            ? new[] { seed.Target.Id }
            : new[] { seed.Parent.Id, seed.Target.Id, seed.Sibling.Id };
        await AssertStoredRowsAsync(observer, seed, deletedIds, actorId, timeout.Token);
        var messages = await observer.OutboxMessages.AsNoTracking().ToListAsync(timeout.Token);
        Assert.Equal(2, messages.Count);
        Assert.All(messages, message => Assert.Equal(OutboxMessageStatus.Pending, message.Status));
        var sync = JsonSerializer.Deserialize<RealtimeSyncIntegrationEvent>(
            Assert.Single(messages, message => message.Type == typeof(RealtimeSyncIntegrationEvent).AssemblyQualifiedName).Content)!;
        Assert.Equal(targetId, sync.EntityId);
        Assert.Equal(seed.Parent.Id, sync.BranchTaskId);
        Assert.Equal(actorId, sync.ActorId);
        if (deleteSubtask)
        {
            var deleted = JsonSerializer.Deserialize<SubtaskDeletedIntegrationEvent>(
                Assert.Single(messages, message => message.Type == typeof(SubtaskDeletedIntegrationEvent).AssemblyQualifiedName).Content)!;
            Assert.Equal((seed.Parent.Id, seed.Target.Id, seed.CreatorId, seed.Target.Title),
                (deleted.ParentTaskId, deleted.SubtaskId, deleted.ActorId, deleted.Title));
            Assert.Equal(RealtimeSyncAction.SubtaskChanged, sync.Action);
            Assert.Empty(sync.AudienceUserIds);
        }
        else
        {
            var deleted = JsonSerializer.Deserialize<TaskDeletedIntegrationEvent>(
                Assert.Single(messages, message => message.Type == typeof(TaskDeletedIntegrationEvent).AssemblyQualifiedName).Content)!;
            Assert.Equal((seed.Parent.Id, seed.Parent.UserId), (deleted.TaskId, deleted.ActorId));
            Assert.Equal(RealtimeSyncAction.TaskDeleted, sync.Action);
            Assert.Equal(new[] { seed.Parent.UserId, seed.CreatorId, seed.OtherFriendId }.OrderBy(id => id),
                sync.AudienceUserIds.OrderBy(id => id));
            Assert.DoesNotContain(Guid.Empty, sync.AudienceUserIds);
        }
    }

    private static async Task<Seed> SeedTreeAsync(TemporaryDatabase database, CancellationToken token)
    {
        await using var context = new TodoDbContext(database.Options<TodoDbContext>());
        await TodoDatabaseStartup.EnsureReadyAsync(context, NullLogger.Instance, token);
        var ownerId = Guid.NewGuid();
        var creatorId = Guid.NewGuid();
        var otherFriendId = Guid.NewGuid();
        var dueStart = DateTime.UtcNow.AddDays(1);
        var parent = TodoItem.Create(
            ownerId, "Atomic deletion tree", "Synthetic parent description", Guid.NewGuid(),
            dueDate: dueStart.AddDays(2), expectedDate: dueStart.AddDays(1),
            priority: TodoPriority.High, sharedWithUserIds: new[] { creatorId, otherFriendId },
            requiredWorkers: 3, dueDateStart: dueStart);
        parent.AddTag("parent", ownerId);
        parent.AddWorker(creatorId);
        parent.AddWorker(otherFriendId);
        var target = TodoItem.CreateSubtask(parent, creatorId, "Repeated subtask title", "Target description");
        target.AddTag("target", ownerId);
        target.AddWorker(ownerId);
        target.AddWorker(creatorId);
        var sibling = TodoItem.CreateSubtask(parent, otherFriendId, "Repeated subtask title", "Sibling description");
        sibling.AddTag("sibling", ownerId);
        sibling.AddWorker(otherFriendId);
        var unrelated = TodoItem.Create(
            ownerId, "Unrelated task", "Synthetic unrelated description", Guid.NewGuid(),
            priority: TodoPriority.Low, sharedWithUserIds: new[] { creatorId }, requiredWorkers: 2);
        unrelated.AddTag("unrelated", ownerId);
        unrelated.AddWorker(creatorId);
        context.TodoItems.AddRange(parent, target, sibling, unrelated);
        await context.SaveChangesAsync(token);
        var stored = await ReadTodosAsync(context, token);
        return new Seed(
            Assert.Single(stored, item => item.Id == parent.Id),
            Assert.Single(stored, item => item.Id == target.Id),
            Assert.Single(stored, item => item.Id == sibling.Id),
            Assert.Single(stored, item => item.Id == unrelated.Id),
            creatorId, otherFriendId);
    }

    private static Task<List<TodoItem>> ReadTodosAsync(TodoDbContext context, CancellationToken token) =>
        context.TodoItems.IgnoreQueryFilters().AsNoTracking().AsSplitQuery()
            .Include(task => task.Tags)
            .Include(task => task.SharedWith)
            .Include(task => task.Workers)
            .ToListAsync(token);

    private static async Task AssertStoredRowsAsync(
        TodoDbContext observer, Seed seed, IReadOnlyCollection<Guid> deletedIds, Guid actorId, CancellationToken token)
    {
        var rows = await ReadTodosAsync(observer, token);
        var expectedRows = new[] { seed.Parent, seed.Target, seed.Sibling, seed.Unrelated };
        Assert.Equal(expectedRows.Length, rows.Count);
        foreach (var expected in expectedRows)
        {
            var actual = Assert.Single(rows, row => row.Id == expected.Id);
            AssertContentUnchanged(expected, actual);
            if (deletedIds.Contains(expected.Id))
            {
                Assert.True(actual.IsDeleted);
                Assert.NotNull(actual.DeletedAt);
                Assert.Equal(actorId, actual.DeletedBy);
            }
            else
            {
                Assert.Equal((expected.IsDeleted, expected.DeletedAt, expected.DeletedBy),
                    (actual.IsDeleted, actual.DeletedAt, actual.DeletedBy));
            }
        }
        Assert.Equal(expectedRows.Sum(row => row.SharedWith.Count),
            await observer.TodoItemShares.AsNoTracking().CountAsync(token));
        Assert.Equal(expectedRows.Sum(row => row.Workers.Count),
            await observer.Set<TodoItemWorker>().AsNoTracking().CountAsync(token));
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
        Assert.Equal((expected.CreatedAt, expected.CreatedBy, expected.UpdatedAt, expected.UpdatedBy),
            (actual.CreatedAt, actual.CreatedBy, actual.UpdatedAt, actual.UpdatedBy));
        Assert.Equal(expected.Tags.OrderBy(tag => tag.Id).Select(tag => (tag.Id, tag.Name)),
            actual.Tags.OrderBy(tag => tag.Id).Select(tag => (tag.Id, tag.Name)));
        Assert.Equal(expected.SharedWith.OrderBy(share => share.SharedWithUserId)
                .Select(share => (share.TodoItemId, share.SharedWithUserId)),
            actual.SharedWith.OrderBy(share => share.SharedWithUserId)
                .Select(share => (share.TodoItemId, share.SharedWithUserId)));
        Assert.Equal(expected.Workers.OrderBy(worker => worker.UserId)
                .Select(worker => (worker.TodoItemId, worker.UserId, worker.JoinedAt)),
            actual.Workers.OrderBy(worker => worker.UserId)
                .Select(worker => (worker.TodoItemId, worker.UserId, worker.JoinedAt)));
    }

    private static void AssertEventAttempts(ControlledOutbox outbox, bool deleteSubtask)
    {
        Assert.Equal(2, outbox.AttemptedMessages.Count);
        Assert.Equal(deleteSubtask
                ? typeof(SubtaskDeletedIntegrationEvent).AssemblyQualifiedName
                : typeof(TaskDeletedIntegrationEvent).AssemblyQualifiedName,
            outbox.AttemptedMessages[0].Type);
        Assert.Equal(typeof(RealtimeSyncIntegrationEvent).AssemblyQualifiedName, outbox.AttemptedMessages[1].Type);
    }

    private static DeleteTodoCommandHandler CreateHandler(
        TodoDbContext context, Seed seed, Guid actorId, IOutboxRepository outbox)
    {
        var currentUser = new Mock<ICurrentUserContext>();
        currentUser.SetupGet(user => user.UserId).Returns(actorId);
        var friendships = new Mock<IFriendshipService>();
        friendships.Setup(service => service.AreFriendsAsync(
                seed.CreatorId, seed.Parent.UserId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);
        return new DeleteTodoCommandHandler(
            new TodoRepository(context),
            outbox,
            new TodoUnitOfWork(context),
            NullLogger<DeleteTodoCommandHandler>.Instance,
            currentUser.Object,
            friendships.Object);
    }

    private sealed record Seed(
        TodoItem Parent, TodoItem Target, TodoItem Sibling, TodoItem Unrelated, Guid CreatorId, Guid OtherFriendId);

    private sealed class ControlledOutbox(IOutboxRepository inner, IOException? secondEventFailure = null)
        : IOutboxRepository
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
            if (AttemptedMessages.Count == 2 && secondEventFailure is not null)
                throw secondEventFailure;
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
