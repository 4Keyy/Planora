using System.Text.Json;
using AutoMapper;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Planora.BuildingBlocks.Application.Context;
using Planora.BuildingBlocks.Application.Messaging.Events;
using Planora.BuildingBlocks.Application.Outbox;
using Planora.Todo.Application.DTOs;
using Planora.Todo.Application.Features.Todos.Commands.UpdateTodo;
using Planora.Todo.Application.Interfaces;
using Planora.Todo.Application.Services;
using Planora.Todo.Domain.Entities;
using Planora.Todo.Domain.Enums;
using Planora.Todo.Infrastructure.Persistence;
using Planora.Todo.Infrastructure.Persistence.Repositories;
using Planora.UnitTests.BuildingBlocks.Retention.Postgres;

namespace Planora.UnitTests.Services.TodoApi.Infrastructure;

public sealed class UpdateTodoOutboxPostgresTests
{
    [PostgresFact]
    public Task OwnerCompletionAsync_LastNotificationFailureRollsBackTaskAndAllEvents() =>
        AssertWriteFailureAsync(Mode.OwnerComplete, failAt: 4);

    [PostgresFact]
    public Task ViewerCompletionAsync_LastMilestoneFailureRollsBackPreferenceWorkerAndAllEvents() =>
        AssertWriteFailureAsync(Mode.ViewerComplete, failAt: 4);

    [PostgresFact]
    public Task SubtaskCompletionAsync_LastBranchSignalFailureRollsBackGlobalStatusAndAllEvents() =>
        AssertWriteFailureAsync(Mode.SubtaskComplete, failAt: 4);

    [PostgresFact]
    public Task OwnerReopenAsync_FirstEventFailurePreservesEveryViewerCompletion() =>
        AssertWriteFailureAsync(Mode.OwnerReopen, failAt: 1);

    [PostgresFact]
    public async Task OwnerReopenAsync_RejectedFeedInsertRollsBackTaskPreferencesAndActivity()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var seed = await SeedAsync(database, Mode.OwnerReopen, timeout.Token);
        await using var context = new TodoDbContext(database.Options<TodoDbContext>());
        await context.Database.ExecuteSqlRawAsync("""
            ALTER TABLE todo."OutboxMessages" ADD CONSTRAINT reject_feed
            CHECK ("Type" NOT LIKE '%RealtimeSyncIntegrationEvent%')
            """, timeout.Token);
        var outbox = new ControlledOutbox(new OutboxRepository(context));
        var handler = CreateHandler(context, seed, Mode.OwnerReopen, outbox);

        await Assert.ThrowsAsync<DbUpdateException>(() =>
            handler.Handle(Command(seed, Mode.OwnerReopen), timeout.Token));

        Assert.Equal(2, outbox.AttemptedMessages.Count);
        await using var observer = new TodoDbContext(database.Options<TodoDbContext>());
        await AssertDataAsync(observer, seed, Mode.OwnerReopen, committed: false, timeout.Token);
        Assert.Empty(await observer.OutboxMessages.AsNoTracking().ToListAsync(timeout.Token));
    }

    [PostgresFact]
    public async Task UpdateAsync_SuccessMatrixCommitsCompleteEventsAndPreservesUnrelatedState()
    {
        foreach (var mode in Enum.GetValues<Mode>())
        {
            await using var database = await TemporaryDatabase.CreateAsync();
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
            var seed = await SeedAsync(database, mode, timeout.Token);
            await using var context = new TodoDbContext(database.Options<TodoDbContext>());
            var outbox = new ControlledOutbox(new OutboxRepository(context));
            var handler = CreateHandler(context, seed, mode, outbox);

            var result = await handler.Handle(Command(seed, mode), timeout.Token);

            Assert.True(result.IsSuccess);
            var target = mode == Mode.SubtaskComplete ? seed.Subtask : seed.Root;
            Assert.Equal(target.Id, result.Value!.Id);
            Assert.Equal(seed.Root.UserId, result.Value.UserId);
            Assert.Equal(mode == Mode.OwnerReopen ? "Todo" : "Done", result.Value.Status);
            Assert.Equal(mode != Mode.OwnerReopen, result.Value.IsCompleted);
            if (mode is Mode.ViewerComplete or Mode.SubtaskComplete)
                Assert.Null(result.Value.CategoryId);
            if (mode == Mode.ViewerComplete)
            {
                Assert.True(result.Value.IsCompletedByViewer);
                Assert.False(result.Value.OwnerCompleted);
                Assert.False(result.Value.IsWorking);
            }
            await using var observer = new TodoDbContext(database.Options<TodoDbContext>());
            await AssertDataAsync(observer, seed, mode, committed: true, timeout.Token);
            await AssertEventsAsync(observer, seed, mode, timeout.Token);
            Assert.Equal(mode == Mode.OwnerReopen ? 2 : 4, outbox.AttemptedMessages.Count);
        }
    }

    private static async Task AssertWriteFailureAsync(Mode mode, int failAt)
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var seed = await SeedAsync(database, mode, timeout.Token);
        await using var context = new TodoDbContext(database.Options<TodoDbContext>());
        var failure = new IOException("Synthetic update event failure");
        var outbox = new ControlledOutbox(new OutboxRepository(context), failAt, failure);
        var handler = CreateHandler(context, seed, mode, outbox);

        var thrown = await Assert.ThrowsAsync<IOException>(() =>
            handler.Handle(Command(seed, mode), timeout.Token));

        Assert.Same(failure, thrown);
        Assert.Equal(failAt, outbox.AttemptedMessages.Count);
        await using var observer = new TodoDbContext(database.Options<TodoDbContext>());
        await AssertDataAsync(observer, seed, mode, committed: false, timeout.Token);
        Assert.Empty(await observer.OutboxMessages.AsNoTracking().ToListAsync(timeout.Token));
    }

    private static UpdateTodoCommand Command(Seed seed, Mode mode) =>
        new(mode == Mode.SubtaskComplete ? seed.Subtask.Id : seed.Root.Id,
            Status: mode == Mode.OwnerReopen ? "Todo" : "Done");

    private static Guid CurrentActor(Seed seed, Mode mode) =>
        mode is Mode.OwnerComplete or Mode.OwnerReopen ? seed.Root.UserId : seed.CollaboratorId;

    private static UpdateTodoCommandHandler CreateHandler(
        TodoDbContext context, Seed seed, Mode mode, IOutboxRepository outbox)
    {
        var actorId = CurrentActor(seed, mode);
        var currentUser = new Mock<ICurrentUserContext>();
        currentUser.SetupGet(user => user.UserId).Returns(actorId);
        currentUser.SetupGet(user => user.Name).Returns(
            mode is Mode.OwnerComplete or Mode.OwnerReopen ? "Audit Owner" : "Audit Collaborator");
        var friendships = new Mock<IFriendshipService>();
        friendships.Setup(service => service.AreFriendsAsync(
                seed.CollaboratorId, seed.Root.UserId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);
        friendships.Setup(service => service.GetFriendshipsAsync(seed.Root.UserId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[]
            {
                new FriendshipInfo(seed.CollaboratorId, DateTime.UtcNow.AddDays(-1)),
                new FriendshipInfo(seed.OtherFriendId, DateTime.UtcNow.AddDays(-1)),
            });
        var categories = new Mock<ICategoryGrpcClient>();
        categories.Setup(service => service.GetCategoryInfoAsync(
                seed.Root.CategoryId!.Value, seed.Root.UserId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new CategoryInfo(seed.Root.CategoryId!.Value, seed.Root.UserId, "Work", "#111111", "briefcase"));
        var mapper = new MapperConfiguration(
            configuration => configuration.AddProfile<TodoItemMappingProfile>(),
            NullLoggerFactory.Instance).CreateMapper();
        return new UpdateTodoCommandHandler(
            new TodoRepository(context), new TodoUnitOfWork(context), mapper,
            NullLogger<UpdateTodoCommandHandler>.Instance, currentUser.Object, categories.Object,
            friendships.Object, new UserTodoViewPreferenceRepository(context), outbox);
    }

    private static async Task<Seed> SeedAsync(TemporaryDatabase database, Mode mode, CancellationToken token)
    {
        await using var context = new TodoDbContext(database.Options<TodoDbContext>());
        await TodoDatabaseStartup.EnsureReadyAsync(context, NullLogger.Instance, token);
        var ownerId = Guid.NewGuid();
        var collaboratorId = Guid.NewGuid();
        var otherFriendId = Guid.NewGuid();
        var formerFriendId = Guid.NewGuid();
        var dueStart = DateTime.UtcNow.AddDays(1);
        var root = TodoItem.Create(
            ownerId, "Atomic update", "Synthetic root description", Guid.NewGuid(),
            dueDate: dueStart.AddDays(2), expectedDate: dueStart.AddDays(1),
            priority: TodoPriority.High, sharedWithUserIds: new[] { collaboratorId, otherFriendId, formerFriendId },
            requiredWorkers: 3, dueDateStart: dueStart);
        root.AddTag("root", ownerId);
        root.AddWorker(collaboratorId);
        root.AddWorker(otherFriendId);
        var subtask = TodoItem.CreateSubtask(root, otherFriendId, "Atomic update step", "Synthetic subtask description");
        subtask.AddTag("subtask", ownerId);
        subtask.AddWorker(ownerId);
        subtask.AddWorker(collaboratorId);
        subtask.AddWorker(otherFriendId);
        if (mode == Mode.OwnerReopen) root.MarkAsDone(ownerId);
        var unrelated = TodoItem.Create(
            ownerId, "Unrelated update", "Synthetic unrelated description", Guid.NewGuid(),
            priority: TodoPriority.Low, sharedWithUserIds: new[] { collaboratorId }, requiredWorkers: 2);
        unrelated.AddTag("unrelated", ownerId);
        unrelated.AddWorker(collaboratorId);
        context.TodoItems.AddRange(root, subtask, unrelated);
        context.UserTodoViewPreferences.AddRange(
            Preference(collaboratorId, root.Id, completed: mode == Mode.OwnerReopen, hidden: true),
            Preference(otherFriendId, root.Id, completed: true, hidden: false),
            Preference(formerFriendId, root.Id, completed: true, hidden: true),
            Preference(collaboratorId, subtask.Id, completed: mode == Mode.OwnerReopen, hidden: true),
            Preference(collaboratorId, unrelated.Id, completed: true, hidden: true));
        await context.SaveChangesAsync(token);
        var rows = await ReadTodosAsync(context, token);
        return new Seed(
            Assert.Single(rows, item => item.Id == root.Id),
            Assert.Single(rows, item => item.Id == subtask.Id),
            Assert.Single(rows, item => item.Id == unrelated.Id),
            await context.UserTodoViewPreferences.AsNoTracking().ToListAsync(token),
            collaboratorId, otherFriendId, formerFriendId);
    }

    private static UserTodoViewPreference Preference(Guid viewerId, Guid taskId, bool completed, bool hidden) =>
        new()
        {
            ViewerId = viewerId, TodoItemId = taskId, HiddenByViewer = hidden, ViewerCategoryId = Guid.NewGuid(),
            CompletedByViewer = completed, CompletedByViewerAt = completed ? DateTime.UtcNow.AddDays(-1) : null,
        };

    private static Task<List<TodoItem>> ReadTodosAsync(TodoDbContext context, CancellationToken token) =>
        context.TodoItems.IgnoreQueryFilters().AsNoTracking().AsSplitQuery()
            .Include(task => task.Tags).Include(task => task.SharedWith).Include(task => task.Workers)
            .ToListAsync(token);

    private static async Task AssertDataAsync(
        TodoDbContext observer, Seed seed, Mode mode, bool committed, CancellationToken token)
    {
        var rows = await ReadTodosAsync(observer, token);
        var expectedRows = new[] { seed.Root, seed.Subtask, seed.Unrelated };
        Assert.Equal(expectedRows.Length, rows.Count);
        var targetId = mode == Mode.SubtaskComplete ? seed.Subtask.Id : seed.Root.Id;
        foreach (var expected in expectedRows)
        {
            var actual = Assert.Single(rows, row => row.Id == expected.Id);
            AssertContentUnchanged(expected, actual);
            if (committed && expected.Id == targetId && mode != Mode.ViewerComplete)
            {
                Assert.Equal(mode == Mode.OwnerReopen ? TodoStatus.Todo : TodoStatus.Done, actual.Status);
                if (mode == Mode.OwnerReopen)
                {
                    Assert.Null(actual.CompletedAt);
                    Assert.Equal(expected.ActualDate, actual.ActualDate);
                }
                else
                {
                    Assert.NotNull(actual.CompletedAt);
                    Assert.NotNull(actual.ActualDate);
                }
                Assert.NotNull(actual.UpdatedAt);
                Assert.Equal(CurrentActor(seed, mode), actual.UpdatedBy);
            }
            else
            {
                Assert.Equal((expected.Status, expected.CompletedAt, expected.ActualDate, expected.UpdatedAt, expected.UpdatedBy),
                    (actual.Status, actual.CompletedAt, actual.ActualDate, actual.UpdatedAt, actual.UpdatedBy));
            }
            var removeWorker = committed && mode == Mode.ViewerComplete && expected.Id == seed.Root.Id;
            Assert.Equal(expected.Workers.Where(worker => !removeWorker || worker.UserId != seed.CollaboratorId)
                    .OrderBy(worker => worker.UserId).Select(worker => (worker.TodoItemId, worker.UserId, worker.JoinedAt)),
                actual.Workers.OrderBy(worker => worker.UserId).Select(worker => (worker.TodoItemId, worker.UserId, worker.JoinedAt)));
        }
        var preferences = await observer.UserTodoViewPreferences.AsNoTracking().ToListAsync(token);
        Assert.Equal(seed.Preferences.Count, preferences.Count);
        foreach (var expected in seed.Preferences)
        {
            var actual = Assert.Single(preferences, row => row.ViewerId == expected.ViewerId && row.TodoItemId == expected.TodoItemId);
            Assert.Equal((expected.HiddenByViewer, expected.ViewerCategoryId), (actual.HiddenByViewer, actual.ViewerCategoryId));
            if (committed && mode == Mode.OwnerReopen && expected.TodoItemId == seed.Root.Id)
            {
                Assert.False(actual.CompletedByViewer);
                Assert.Null(actual.CompletedByViewerAt);
            }
            else if (committed && mode == Mode.ViewerComplete && expected.TodoItemId == seed.Root.Id &&
                     expected.ViewerId == seed.CollaboratorId)
            {
                Assert.True(actual.CompletedByViewer);
                Assert.NotNull(actual.CompletedByViewerAt);
            }
            else
            {
                Assert.Equal((expected.CompletedByViewer, expected.CompletedByViewerAt),
                    (actual.CompletedByViewer, actual.CompletedByViewerAt));
            }
        }
        Assert.Equal(expectedRows.Sum(row => row.Workers.Count) - (committed && mode == Mode.ViewerComplete ? 1 : 0),
            await observer.Set<TodoItemWorker>().AsNoTracking().CountAsync(token));
        Assert.Equal(expectedRows.Sum(row => row.SharedWith.Count), await observer.TodoItemShares.AsNoTracking().CountAsync(token));
    }

    private static void AssertContentUnchanged(TodoItem expected, TodoItem actual)
    {
        Assert.Equal((expected.Id, expected.UserId, expected.CreatedByUserId, expected.ParentTodoId),
            (actual.Id, actual.UserId, actual.CreatedByUserId, actual.ParentTodoId));
        Assert.Equal((expected.Title, expected.Description, expected.Priority, expected.CategoryId),
            (actual.Title, actual.Description, actual.Priority, actual.CategoryId));
        Assert.Equal((expected.DueDateStart, expected.DueDate, expected.ExpectedDate),
            (actual.DueDateStart, actual.DueDate, actual.ExpectedDate));
        Assert.Equal((expected.IsPublic, expected.AllFriendsSnapshotAt, expected.RequiredWorkers, expected.Hidden),
            (actual.IsPublic, actual.AllFriendsSnapshotAt, actual.RequiredWorkers, actual.Hidden));
        Assert.Equal((expected.CreatedAt, expected.CreatedBy, expected.IsDeleted, expected.DeletedAt, expected.DeletedBy),
            (actual.CreatedAt, actual.CreatedBy, actual.IsDeleted, actual.DeletedAt, actual.DeletedBy));
        Assert.Equal(expected.Tags.OrderBy(tag => tag.Id).Select(tag => (tag.Id, tag.Name)),
            actual.Tags.OrderBy(tag => tag.Id).Select(tag => (tag.Id, tag.Name)));
        Assert.Equal(expected.SharedWith.OrderBy(share => share.SharedWithUserId).Select(share => (share.TodoItemId, share.SharedWithUserId)),
            actual.SharedWith.OrderBy(share => share.SharedWithUserId).Select(share => (share.TodoItemId, share.SharedWithUserId)));
    }

    private static async Task AssertEventsAsync(TodoDbContext observer, Seed seed, Mode mode, CancellationToken token)
    {
        var messages = await observer.OutboxMessages.AsNoTracking().ToListAsync(token);
        Assert.Equal(mode == Mode.OwnerReopen ? 2 : 4, messages.Count);
        Assert.All(messages, message => Assert.Equal(OutboxMessageStatus.Pending, message.Status));
        var actorId = CurrentActor(seed, mode);
        var actorName = mode is Mode.OwnerComplete or Mode.OwnerReopen ? "Audit Owner" : "Audit Collaborator";
        var activity = JsonSerializer.Deserialize<TaskActivityIntegrationEvent>(
            Assert.Single(messages, message => message.Type == typeof(TaskActivityIntegrationEvent).AssemblyQualifiedName).Content)!;
        Assert.Equal(seed.Root.Id, activity.TaskId);
        Assert.Equal(actorId, activity.ActorId);
        Assert.Equal(actorName, activity.ActorName);
        Assert.Equal(mode switch
        {
            Mode.SubtaskComplete => TaskActivityType.SubtaskCompleted,
            Mode.OwnerReopen => TaskActivityType.Left,
            _ => TaskActivityType.Completed,
        }, activity.ActivityType);
        Assert.Equal(mode == Mode.SubtaskComplete ? seed.Subtask.Title : null, activity.Detail);
        var sync = JsonSerializer.Deserialize<RealtimeSyncIntegrationEvent>(
            Assert.Single(messages, message => message.Type == typeof(RealtimeSyncIntegrationEvent).AssemblyQualifiedName).Content)!;
        Assert.Equal(mode == Mode.SubtaskComplete ? seed.Subtask.Id : seed.Root.Id, sync.EntityId);
        Assert.Equal(seed.Root.Id, sync.BranchTaskId);
        Assert.Equal(actorId, sync.ActorId);
        Assert.Equal(mode switch
        {
            Mode.OwnerComplete => RealtimeSyncAction.TaskCompleted,
            Mode.ViewerComplete => RealtimeSyncAction.BranchActivity,
            Mode.SubtaskComplete => RealtimeSyncAction.SubtaskChanged,
            _ => RealtimeSyncAction.TaskReopened,
        }, sync.Action);
        if (mode is Mode.OwnerComplete or Mode.OwnerReopen)
            Assert.Equal(new[] { seed.Root.UserId, seed.CollaboratorId, seed.OtherFriendId, seed.FormerFriendId }.OrderBy(id => id),
                sync.AudienceUserIds.OrderBy(id => id));
        else
            Assert.Empty(sync.AudienceUserIds);

        var notifications = messages.Where(message => message.Type == typeof(NotificationEvent).AssemblyQualifiedName)
            .Select(message => JsonSerializer.Deserialize<NotificationEvent>(message.Content)!).ToArray();
        Assert.Equal(mode == Mode.OwnerReopen ? 0 : 2, notifications.Length);
        var expectedRecipients = mode == Mode.OwnerComplete
            ? new[] { seed.CollaboratorId, seed.OtherFriendId }
            : mode == Mode.OwnerReopen ? Array.Empty<Guid>() : new[] { seed.Root.UserId, seed.OtherFriendId };
        Assert.Equal(expectedRecipients.OrderBy(id => id), notifications.Select(notification => notification.UserId).OrderBy(id => id));
        foreach (var notification in notifications)
        {
            Assert.Equal(seed.Root.Id, notification.TaskId);
            Assert.Equal(actorId, notification.ActorId);
            Assert.NotEqual(actorId, notification.UserId);
            Assert.NotEqual(seed.FormerFriendId, notification.UserId);
            var milestone = mode == Mode.ViewerComplete && notification.UserId == seed.Root.UserId;
            Assert.Equal(milestone ? NotificationType.TaskParticipantsDone : mode == Mode.SubtaskComplete
                ? NotificationType.SubtaskCompleted : NotificationType.TaskCompleted, notification.Type);
            Assert.Equal(milestone ? "All collaborators done" : mode == Mode.SubtaskComplete
                ? "Subtask completed" : "Task completed", notification.Title);
            Assert.Equal(milestone ? "All collaborators completed “Atomic update” — some subtasks remain"
                : mode == Mode.SubtaskComplete ? "Audit Collaborator completed a subtask: “Atomic update step”"
                : $"{actorName} completed “Atomic update”", notification.Message);
        }
    }

    private enum Mode { OwnerComplete, ViewerComplete, SubtaskComplete, OwnerReopen }

    private sealed record Seed(TodoItem Root, TodoItem Subtask, TodoItem Unrelated,
        List<UserTodoViewPreference> Preferences, Guid CollaboratorId, Guid OtherFriendId, Guid FormerFriendId);

    private sealed class ControlledOutbox(IOutboxRepository inner, int? failureAt = null, IOException? failure = null)
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
            if (AttemptedMessages.Count == failureAt && failure is not null) throw failure;
        }
        public Task<IReadOnlyList<OutboxMessage>> GetPendingMessagesAsync(int batchSize, CancellationToken cancellationToken = default) =>
            inner.GetPendingMessagesAsync(batchSize, cancellationToken);
        public Task UpdateAsync(OutboxMessage message, CancellationToken cancellationToken = default) =>
            inner.UpdateAsync(message, cancellationToken);
        public Task DeleteProcessedMessagesAsync(DateTime olderThan, CancellationToken cancellationToken = default) =>
            inner.DeleteProcessedMessagesAsync(olderThan, cancellationToken);
    }
}
