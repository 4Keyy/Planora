using System.Text.Json;
using AutoMapper;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Planora.BuildingBlocks.Application.Context;
using Planora.BuildingBlocks.Application.Messaging.Events;
using Planora.BuildingBlocks.Application.Outbox;
using Planora.Todo.Application.DTOs;
using Planora.Todo.Application.Features.Todos.Commands.DuplicateTodo;
using Planora.Todo.Application.Interfaces;
using Planora.Todo.Application.Services;
using Planora.Todo.Domain.Entities;
using Planora.Todo.Domain.Enums;
using Planora.Todo.Infrastructure.Persistence;
using Planora.Todo.Infrastructure.Persistence.Repositories;
using Planora.UnitTests.BuildingBlocks.Retention.Postgres;

namespace Planora.UnitTests.Services.TodoApi.Infrastructure;

public sealed class DuplicateTodoOutboxPostgresTests
{
    [PostgresFact]
    public async Task DuplicateAsync_SecondEventFailurePreservesSourceAndLeavesNoCopyOrEvents()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var source = await SeedSourceAsync(database, timeout.Token);
        var friendId = Assert.Single(source.SharedWith).SharedWithUserId;
        await using var context = new TodoDbContext(database.Options<TodoDbContext>());
        var failure = new IOException("Synthetic second duplicate event failure");
        var outbox = new ControlledOutbox(new OutboxRepository(context), failure);
        var handler = CreateHandler(context, source, friendId, outbox);

        var thrown = await Assert.ThrowsAsync<IOException>(() =>
            handler.Handle(new DuplicateTodoCommand(source.Id), timeout.Token));

        Assert.Same(failure, thrown);
        AssertCreationAttempts(outbox);
        await using var observer = new TodoDbContext(database.Options<TodoDbContext>());
        var stored = Assert.Single(await ReadTodosAsync(observer, timeout.Token));
        AssertSourceUnchanged(source, stored);
        Assert.Empty(await observer.OutboxMessages.AsNoTracking().ToListAsync(timeout.Token));
        Assert.Equal(source.Id, Assert.Single(await observer.TodoItemShares.AsNoTracking()
            .ToListAsync(timeout.Token)).TodoItemId);
        Assert.Equal(source.Id, Assert.Single(await observer.Set<TodoItemWorker>().AsNoTracking()
            .ToListAsync(timeout.Token)).TodoItemId);
    }

    [PostgresFact]
    public async Task DuplicateAsync_RejectedFeedInsertRollsBackCopyAndPreservesSource()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var source = await SeedSourceAsync(database, timeout.Token);
        var friendId = Assert.Single(source.SharedWith).SharedWithUserId;
        await using var context = new TodoDbContext(database.Options<TodoDbContext>());
        await context.Database.ExecuteSqlRawAsync("""
            ALTER TABLE todo."OutboxMessages" ADD CONSTRAINT reject_feed
            CHECK ("Type" NOT LIKE '%RealtimeSyncIntegrationEvent%')
            """, timeout.Token);
        var outbox = new ControlledOutbox(new OutboxRepository(context));
        var handler = CreateHandler(context, source, friendId, outbox);

        await Assert.ThrowsAsync<DbUpdateException>(() =>
            handler.Handle(new DuplicateTodoCommand(source.Id), timeout.Token));

        AssertCreationAttempts(outbox);
        await using var observer = new TodoDbContext(database.Options<TodoDbContext>());
        AssertSourceUnchanged(source, Assert.Single(await ReadTodosAsync(observer, timeout.Token)));
        Assert.Empty(await observer.OutboxMessages.AsNoTracking().ToListAsync(timeout.Token));
        Assert.Equal(source.Id, Assert.Single(await observer.TodoItemShares.AsNoTracking()
            .ToListAsync(timeout.Token)).TodoItemId);
        Assert.Equal(source.Id, Assert.Single(await observer.Set<TodoItemWorker>().AsNoTracking()
            .ToListAsync(timeout.Token)).TodoItemId);
    }

    [PostgresFact]
    public async Task DuplicateAsync_CommitsFreshCopyAndCompleteCreationAndFeedEvents()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        var source = await SeedSourceAsync(database, timeout.Token);
        var friendId = Assert.Single(source.SharedWith).SharedWithUserId;
        await using var context = new TodoDbContext(database.Options<TodoDbContext>());
        var outbox = new ControlledOutbox(new OutboxRepository(context));
        var handler = CreateHandler(context, source, friendId, outbox);

        var result = await handler.Handle(new DuplicateTodoCommand(source.Id), timeout.Token);

        Assert.True(result.IsSuccess);
        AssertCreationAttempts(outbox);
        await using var observer = new TodoDbContext(database.Options<TodoDbContext>());
        var tasks = await ReadTodosAsync(observer, timeout.Token);
        Assert.Equal(2, tasks.Count);
        AssertSourceUnchanged(source, Assert.Single(tasks, task => task.Id == source.Id));
        var copy = Assert.Single(tasks, task => task.Id != source.Id);
        Assert.Equal(result.Value!.Id, copy.Id);
        Assert.Equal((source.UserId, source.Title, source.Description, source.Priority, source.CategoryId),
            (copy.UserId, copy.Title, copy.Description, copy.Priority, copy.CategoryId));
        Assert.Equal(source.RequiredWorkers, copy.RequiredWorkers);
        Assert.Equal(friendId, Assert.Single(copy.SharedWith).SharedWithUserId);
        Assert.Equal(Assert.Single(source.Tags).Name, Assert.Single(copy.Tags).Name);
        Assert.NotEqual(Assert.Single(source.Tags).Id, Assert.Single(copy.Tags).Id);
        Assert.Equal(TodoStatus.Todo, copy.Status);
        Assert.False(copy.IsPublic);
        Assert.Null(copy.AllFriendsSnapshotAt);
        Assert.False(copy.IsCompleted);
        Assert.False(copy.Hidden);
        Assert.Null(copy.CompletedAt);
        Assert.Null(copy.ActualDate);
        Assert.Null(copy.DueDateStart);
        Assert.Null(copy.DueDate);
        Assert.Null(copy.ExpectedDate);
        Assert.Null(copy.ParentTodoId);
        Assert.Empty(copy.Workers);
        Assert.Equal("Work", result.Value.CategoryName);
        Assert.Equal("#111111", result.Value.CategoryColor);
        Assert.Equal("briefcase", result.Value.CategoryIcon);

        var messages = await observer.OutboxMessages.AsNoTracking().ToListAsync(timeout.Token);
        Assert.Equal(2, messages.Count);
        Assert.All(messages, message => Assert.Equal(OutboxMessageStatus.Pending, message.Status));
        var created = JsonSerializer.Deserialize<TaskCreatedIntegrationEvent>(
            Assert.Single(messages, message => message.Type == typeof(TaskCreatedIntegrationEvent).AssemblyQualifiedName).Content)!;
        Assert.Equal((copy.Id, source.UserId, "Audit Owner", source.Description),
            (created.TaskId, created.OwnerId, created.OwnerName, created.Description));
        var feed = JsonSerializer.Deserialize<RealtimeSyncIntegrationEvent>(
            Assert.Single(messages, message => message.Type == typeof(RealtimeSyncIntegrationEvent).AssemblyQualifiedName).Content)!;
        Assert.Equal(RealtimeSyncAction.TaskCreated, feed.Action);
        Assert.Equal(copy.Id, feed.EntityId);
        Assert.Equal(Guid.Empty, feed.BranchTaskId);
        Assert.Equal(source.UserId, feed.ActorId);
        Assert.Equal(new[] { source.UserId, friendId }.OrderBy(id => id),
            feed.AudienceUserIds.OrderBy(id => id));
        Assert.DoesNotContain(Guid.Empty, feed.AudienceUserIds);
    }

    private static async Task<TodoItem> SeedSourceAsync(TemporaryDatabase database, CancellationToken token)
    {
        await using var context = new TodoDbContext(database.Options<TodoDbContext>());
        await TodoDatabaseStartup.EnsureReadyAsync(context, NullLogger.Instance, token);
        var ownerId = Guid.NewGuid();
        var friendId = Guid.NewGuid();
        var dueStart = DateTime.UtcNow.AddDays(1);
        var source = TodoItem.Create(
            ownerId, "Atomic duplicate", "Synthetic duplicate description", Guid.NewGuid(),
            dueDate: dueStart.AddDays(2), expectedDate: dueStart.AddDays(1),
            priority: TodoPriority.High, sharedWithUserIds: new[] { friendId },
            requiredWorkers: 2, dueDateStart: dueStart);
        source.AddTag("audit", ownerId);
        source.AddWorker(friendId);
        source.MarkAsDone(ownerId);
        source.SetHidden(true, ownerId);
        context.TodoItems.Add(source);
        await context.SaveChangesAsync(token);

        return Assert.Single(await ReadTodosAsync(context, token));
    }

    private static Task<List<TodoItem>> ReadTodosAsync(TodoDbContext context, CancellationToken token) =>
        context.TodoItems.AsNoTracking().AsSplitQuery()
            .Include(task => task.Tags)
            .Include(task => task.SharedWith)
            .Include(task => task.Workers)
            .ToListAsync(token);

    private static void AssertSourceUnchanged(TodoItem expected, TodoItem actual)
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
        Assert.Equal((expected.IsDeleted, expected.DeletedAt, expected.DeletedBy),
            (actual.IsDeleted, actual.DeletedAt, actual.DeletedBy));
        Assert.Equal(expected.Tags.OrderBy(tag => tag.Id).Select(tag => (tag.Id, tag.Name)),
            actual.Tags.OrderBy(tag => tag.Id).Select(tag => (tag.Id, tag.Name)));
        Assert.Equal(expected.SharedWith.Select(share => (share.TodoItemId, share.SharedWithUserId)),
            actual.SharedWith.Select(share => (share.TodoItemId, share.SharedWithUserId)));
        Assert.Equal(expected.Workers.Select(worker => (worker.TodoItemId, worker.UserId, worker.JoinedAt)),
            actual.Workers.Select(worker => (worker.TodoItemId, worker.UserId, worker.JoinedAt)));
    }

    private static void AssertCreationAttempts(ControlledOutbox outbox)
    {
        Assert.Equal(2, outbox.AttemptedMessages.Count);
        Assert.Equal(typeof(TaskCreatedIntegrationEvent).AssemblyQualifiedName, outbox.AttemptedMessages[0].Type);
        Assert.Equal(typeof(RealtimeSyncIntegrationEvent).AssemblyQualifiedName, outbox.AttemptedMessages[1].Type);
    }

    private static DuplicateTodoCommandHandler CreateHandler(
        TodoDbContext context, TodoItem source, Guid friendId, IOutboxRepository outbox)
    {
        var currentUser = new Mock<ICurrentUserContext>();
        currentUser.SetupGet(user => user.UserId).Returns(source.UserId);
        currentUser.SetupGet(user => user.Name).Returns("Audit Owner");
        var friendships = new Mock<IFriendshipService>();
        friendships.Setup(service => service.GetFriendshipsAsync(source.UserId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { new FriendshipInfo(friendId, DateTime.UtcNow.AddDays(-1)) });
        var categories = new Mock<ICategoryGrpcClient>();
        categories.Setup(service => service.GetCategoryInfoAsync(
                source.CategoryId!.Value, source.UserId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new CategoryInfo(source.CategoryId!.Value, source.UserId, "Work", "#111111", "briefcase"));
        var mapper = new MapperConfiguration(
            configuration => configuration.AddProfile<TodoItemMappingProfile>(),
            NullLoggerFactory.Instance).CreateMapper();
        return new DuplicateTodoCommandHandler(
            new TodoRepository(context),
            new TodoUnitOfWork(context),
            mapper,
            NullLogger<DuplicateTodoCommandHandler>.Instance,
            currentUser.Object,
            categories.Object,
            friendships.Object,
            outbox);
    }

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
