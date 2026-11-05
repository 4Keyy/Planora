using System.Text.Json;
using AutoMapper;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Planora.BuildingBlocks.Application.Context;
using Planora.BuildingBlocks.Application.Messaging.Events;
using Planora.BuildingBlocks.Application.Outbox;
using Planora.Todo.Application.DTOs;
using Planora.Todo.Application.Features.Todos.Commands.CreateSubtask;
using Planora.Todo.Application.Interfaces;
using Planora.Todo.Application.Services;
using Planora.Todo.Domain.Entities;
using Planora.Todo.Domain.Enums;
using Planora.Todo.Infrastructure.Persistence;
using Planora.Todo.Infrastructure.Persistence.Repositories;
using Planora.UnitTests.BuildingBlocks.Retention.Postgres;

namespace Planora.UnitTests.Services.TodoApi.Infrastructure;

public sealed class CreateSubtaskOutboxPostgresTests
{
    [PostgresFact]
    public async Task CreateAsync_LastRecipientFailureRollsBackSubtaskParentTouchAndAllEvents()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var seed = await SeedParentAsync(database, timeout.Token);
        await using var context = new TodoDbContext(database.Options<TodoDbContext>());
        var failure = new IOException("Synthetic last subtask recipient failure");
        var outbox = new ControlledOutbox(new OutboxRepository(context), failureAt: 3, failure);
        var handler = CreateHandler(context, seed, outbox);

        var thrown = await Assert.ThrowsAsync<IOException>(() =>
            handler.Handle(Command(seed.Parent.Id), timeout.Token));

        Assert.Same(failure, thrown);
        AssertCompleteEventAttempts(outbox);
        await AssertRolledBackAsync(database, seed, timeout.Token);
    }

    [PostgresFact]
    public async Task CreateAsync_RejectedNotificationInsertRollsBackSubtaskParentTouchAndFeed()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var seed = await SeedParentAsync(database, timeout.Token);
        await using var context = new TodoDbContext(database.Options<TodoDbContext>());
        await context.Database.ExecuteSqlRawAsync("""
            ALTER TABLE todo."OutboxMessages" ADD CONSTRAINT reject_notification
            CHECK ("Type" NOT LIKE '%NotificationEvent%')
            """, timeout.Token);
        var outbox = new ControlledOutbox(new OutboxRepository(context));
        var handler = CreateHandler(context, seed, outbox);

        await Assert.ThrowsAsync<DbUpdateException>(() =>
            handler.Handle(Command(seed.Parent.Id), timeout.Token));

        await AssertRolledBackAsync(database, seed, timeout.Token);
        AssertCompleteEventAttempts(outbox);
    }

    [PostgresFact]
    public async Task CreateAsync_CancellationDuringRecipientLookupLeavesNoSubtaskOrEvents()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        using var requestCancellation = new CancellationTokenSource();
        var seed = await SeedParentAsync(database, timeout.Token);
        await using var context = new TodoDbContext(database.Options<TodoDbContext>());
        var outbox = new ControlledOutbox(new OutboxRepository(context));
        var handler = CreateHandler(context, seed, outbox, () => requestCancellation.Cancel());

        var thrown = await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            handler.Handle(Command(seed.Parent.Id), requestCancellation.Token));

        Assert.Equal(requestCancellation.Token, thrown.CancellationToken);
        Assert.Equal(2, outbox.AttemptedMessages.Count);
        await AssertRolledBackAsync(database, seed, timeout.Token);
    }

    [PostgresFact]
    public async Task CreateAsync_CommitsInheritedSubtaskBranchSignalAndEveryOtherCurrentRecipient()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var seed = await SeedParentAsync(database, timeout.Token);
        await using var context = new TodoDbContext(database.Options<TodoDbContext>());
        var outbox = new ControlledOutbox(new OutboxRepository(context));
        var handler = CreateHandler(context, seed, outbox);

        var result = await handler.Handle(Command(seed.Parent.Id), timeout.Token);

        Assert.True(result.IsSuccess);
        AssertCompleteEventAttempts(outbox);
        await using var observer = new TodoDbContext(database.Options<TodoDbContext>());
        var tasks = await ReadTodosAsync(observer, timeout.Token);
        Assert.Equal(2, tasks.Count);
        var parent = Assert.Single(tasks, task => task.Id == seed.Parent.Id);
        AssertParentContentUnchanged(seed.Parent, parent);
        Assert.Equal(seed.ActorId, parent.UpdatedBy);
        Assert.NotNull(parent.UpdatedAt);
        Assert.True(parent.UpdatedAt.Value > seed.Parent.UpdatedAt!.Value);
        var subtask = Assert.Single(tasks, task => task.Id != seed.Parent.Id);
        Assert.Equal(result.Value!.Id, subtask.Id);
        Assert.Equal(seed.Parent.Id, subtask.ParentTodoId);
        Assert.Equal(seed.Parent.UserId, subtask.UserId);
        Assert.Equal(seed.ActorId, subtask.CreatedByUserId);
        Assert.Equal("Atomic subtask", subtask.Title);
        Assert.Equal("Synthetic subtask description", subtask.Description);
        Assert.Equal(TodoPriority.High, subtask.Priority);
        Assert.Equal(seed.Parent.CategoryId, subtask.CategoryId);
        Assert.Equal(seed.Parent.IsPublic, subtask.IsPublic);
        Assert.Equal(seed.Parent.AllFriendsSnapshotAt, subtask.AllFriendsSnapshotAt);
        Assert.Equal(seed.Parent.SharedWith.Select(share => share.SharedWithUserId).OrderBy(id => id),
            subtask.SharedWith.Select(share => share.SharedWithUserId).OrderBy(id => id));
        Assert.Equal(TodoStatus.Todo, subtask.Status);
        Assert.False(subtask.IsCompleted);
        Assert.False(subtask.Hidden);
        Assert.Null(subtask.CompletedAt);
        Assert.Null(subtask.ActualDate);
        Assert.Null(subtask.DueDateStart);
        Assert.Null(subtask.DueDate);
        Assert.Null(subtask.ExpectedDate);
        Assert.Null(subtask.RequiredWorkers);
        Assert.Empty(subtask.Tags);
        Assert.Empty(subtask.Workers);
        Assert.Equal("Audit Collaborator", result.Value.AuthorName);

        var messages = await observer.OutboxMessages.AsNoTracking().ToListAsync(timeout.Token);
        Assert.Equal(3, messages.Count);
        Assert.All(messages, message => Assert.Equal(OutboxMessageStatus.Pending, message.Status));
        var branch = JsonSerializer.Deserialize<RealtimeSyncIntegrationEvent>(
            Assert.Single(messages, message => message.Type == typeof(RealtimeSyncIntegrationEvent).AssemblyQualifiedName).Content)!;
        Assert.Equal(RealtimeSyncAction.SubtaskChanged, branch.Action);
        Assert.Equal(subtask.Id, branch.EntityId);
        Assert.Equal(seed.Parent.Id, branch.BranchTaskId);
        Assert.Equal(seed.ActorId, branch.ActorId);
        Assert.Empty(branch.AudienceUserIds);
        var notifications = messages
            .Where(message => message.Type == typeof(NotificationEvent).AssemblyQualifiedName)
            .Select(message => JsonSerializer.Deserialize<NotificationEvent>(message.Content)!)
            .ToArray();
        Assert.Equal(new[] { seed.Parent.UserId, seed.OtherFriendId }.OrderBy(id => id),
            notifications.Select(notification => notification.UserId).OrderBy(id => id));
        Assert.All(notifications, notification =>
        {
            Assert.Equal(seed.Parent.Id, notification.TaskId);
            Assert.Equal(seed.ActorId, notification.ActorId);
            Assert.Equal(NotificationType.SubtaskAdded, notification.Type);
            Assert.Equal("New subtask", notification.Title);
            Assert.Equal("Audit Collaborator added a subtask: “Atomic subtask”", notification.Message);
            Assert.NotEqual(seed.ActorId, notification.UserId);
            Assert.NotEqual(seed.FormerFriendId, notification.UserId);
            Assert.NotEqual(Guid.Empty, notification.UserId);
        });
    }

    private static CreateSubtaskCommand Command(Guid parentId) =>
        new(parentId, "Atomic subtask", "Synthetic subtask description", TodoPriority.High);

    private static async Task<Seed> SeedParentAsync(TemporaryDatabase database, CancellationToken token)
    {
        await using var context = new TodoDbContext(database.Options<TodoDbContext>());
        await TodoDatabaseStartup.EnsureReadyAsync(context, NullLogger.Instance, token);
        var ownerId = Guid.NewGuid();
        var actorId = Guid.NewGuid();
        var otherFriendId = Guid.NewGuid();
        var formerFriendId = Guid.NewGuid();
        var dueStart = DateTime.UtcNow.AddDays(1);
        var parent = TodoItem.Create(
            ownerId, "Atomic parent", "Synthetic parent description", Guid.NewGuid(),
            dueDate: dueStart.AddDays(2), expectedDate: dueStart.AddDays(1),
            priority: TodoPriority.Low, sharedWithUserIds: new[] { actorId, otherFriendId, formerFriendId },
            requiredWorkers: 3, dueDateStart: dueStart);
        parent.AddTag("audit", ownerId);
        parent.AddWorker(actorId);
        parent.AddWorker(otherFriendId);
        context.TodoItems.Add(parent);
        await context.SaveChangesAsync(token);

        return new Seed(Assert.Single(await ReadTodosAsync(context, token)), actorId, otherFriendId, formerFriendId);
    }

    private static Task<List<TodoItem>> ReadTodosAsync(TodoDbContext context, CancellationToken token) =>
        context.TodoItems.AsNoTracking().AsSplitQuery()
            .Include(task => task.Tags)
            .Include(task => task.SharedWith)
            .Include(task => task.Workers)
            .ToListAsync(token);

    private static async Task AssertRolledBackAsync(TemporaryDatabase database, Seed seed, CancellationToken token)
    {
        await using var observer = new TodoDbContext(database.Options<TodoDbContext>());
        var parent = Assert.Single(await ReadTodosAsync(observer, token));
        AssertParentContentUnchanged(seed.Parent, parent);
        Assert.Equal((seed.Parent.UpdatedAt, seed.Parent.UpdatedBy), (parent.UpdatedAt, parent.UpdatedBy));
        Assert.Empty(await observer.OutboxMessages.AsNoTracking().ToListAsync(token));
        Assert.Equal(seed.Parent.SharedWith.Count,
            await observer.TodoItemShares.AsNoTracking().CountAsync(token));
        Assert.Equal(seed.Parent.Workers.Count,
            await observer.Set<TodoItemWorker>().AsNoTracking().CountAsync(token));
    }

    private static void AssertParentContentUnchanged(TodoItem expected, TodoItem actual)
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
        Assert.Equal(expected.Workers.OrderBy(worker => worker.UserId)
                .Select(worker => (worker.TodoItemId, worker.UserId, worker.JoinedAt)),
            actual.Workers.OrderBy(worker => worker.UserId)
                .Select(worker => (worker.TodoItemId, worker.UserId, worker.JoinedAt)));
    }

    private static void AssertCompleteEventAttempts(ControlledOutbox outbox)
    {
        Assert.Equal(3, outbox.AttemptedMessages.Count);
        Assert.Equal(typeof(RealtimeSyncIntegrationEvent).AssemblyQualifiedName, outbox.AttemptedMessages[0].Type);
        Assert.All(outbox.AttemptedMessages.Skip(1), message =>
            Assert.Equal(typeof(NotificationEvent).AssemblyQualifiedName, message.Type));
    }

    private static CreateSubtaskCommandHandler CreateHandler(
        TodoDbContext context, Seed seed, IOutboxRepository outbox, Action? beforeContentAudience = null)
    {
        var currentUser = new Mock<ICurrentUserContext>();
        currentUser.SetupGet(user => user.UserId).Returns(seed.ActorId);
        currentUser.SetupGet(user => user.Name).Returns("Audit Collaborator");
        var friendships = new Mock<IFriendshipService>();
        friendships.Setup(service => service.AreFriendsAsync(
                seed.ActorId, seed.Parent.UserId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);
        friendships.Setup(service => service.GetFriendshipsAsync(seed.Parent.UserId, It.IsAny<CancellationToken>()))
            .Callback<Guid, CancellationToken>((_, _) => beforeContentAudience?.Invoke())
            .ReturnsAsync(new[]
            {
                new FriendshipInfo(seed.ActorId, DateTime.UtcNow.AddDays(-1)),
                new FriendshipInfo(seed.OtherFriendId, DateTime.UtcNow.AddDays(-1)),
            });
        var mapper = new MapperConfiguration(
            configuration => configuration.AddProfile<TodoItemMappingProfile>(),
            NullLoggerFactory.Instance).CreateMapper();
        return new CreateSubtaskCommandHandler(
            new TodoRepository(context),
            new TodoUnitOfWork(context),
            mapper,
            NullLogger<CreateSubtaskCommandHandler>.Instance,
            currentUser.Object,
            friendships.Object,
            Mock.Of<ICategoryGrpcClient>(),
            outbox);
    }

    private sealed record Seed(TodoItem Parent, Guid ActorId, Guid OtherFriendId, Guid FormerFriendId);

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
            if (AttemptedMessages.Count == failureAt && failure is not null)
                throw failure;
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
