using System.Text.Json;
using AutoMapper;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Planora.BuildingBlocks.Application.Context;
using Planora.BuildingBlocks.Application.Messaging.Events;
using Planora.BuildingBlocks.Application.Outbox;
using Planora.Todo.Application.DTOs;
using Planora.Todo.Application.Features.Todos.Commands.CreateTodo;
using Planora.Todo.Application.Interfaces;
using Planora.Todo.Application.Services;
using Planora.Todo.Infrastructure.Persistence;
using Planora.Todo.Infrastructure.Persistence.Repositories;
using Planora.UnitTests.BuildingBlocks.Retention.Postgres;

namespace Planora.UnitTests.Services.TodoApi.Infrastructure;

public sealed class CreateTodoOutboxPostgresTests
{
    [PostgresFact]
    public async Task CreateAsync_SecondEventFailureLeavesNoTaskOrOutboxRows()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        await using var context = new TodoDbContext(database.Options<TodoDbContext>());
        await TodoDatabaseStartup.EnsureReadyAsync(context, NullLogger.Instance, timeout.Token);
        var ownerId = Guid.NewGuid();
        var friendId = Guid.NewGuid();
        var failure = new IOException("Synthetic second outbox event failure");
        var outbox = new ControlledOutbox(new OutboxRepository(context), failure);
        var handler = CreateHandler(context, ownerId, friendId, outbox);

        var thrown = await Assert.ThrowsAsync<IOException>(() =>
            handler.Handle(Command(friendId), timeout.Token));

        Assert.Same(failure, thrown);
        Assert.Equal(2, outbox.AttemptedMessages.Count);
        Assert.Equal(typeof(TaskCreatedIntegrationEvent).AssemblyQualifiedName, outbox.AttemptedMessages[0].Type);
        Assert.Equal(typeof(RealtimeSyncIntegrationEvent).AssemblyQualifiedName, outbox.AttemptedMessages[1].Type);
        await using var observer = new TodoDbContext(database.Options<TodoDbContext>());
        Assert.Empty(await observer.TodoItems.AsNoTracking().ToListAsync(timeout.Token));
        Assert.Empty(await observer.TodoItemShares.AsNoTracking().ToListAsync(timeout.Token));
        Assert.Empty(await observer.OutboxMessages.AsNoTracking().ToListAsync(timeout.Token));
    }

    [PostgresFact]
    public async Task CreateAsync_RejectedFeedInsertRollsBackTaskSharesAndCreationEvent()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        await using var context = new TodoDbContext(database.Options<TodoDbContext>());
        await TodoDatabaseStartup.EnsureReadyAsync(context, NullLogger.Instance, timeout.Token);
        await context.Database.ExecuteSqlRawAsync("""
            ALTER TABLE todo."OutboxMessages" ADD CONSTRAINT reject_feed
            CHECK ("Type" NOT LIKE '%RealtimeSyncIntegrationEvent%')
            """, timeout.Token);
        var outbox = new ControlledOutbox(new OutboxRepository(context));
        var friendId = Guid.NewGuid();
        var handler = CreateHandler(context, Guid.NewGuid(), friendId, outbox);

        await Assert.ThrowsAsync<DbUpdateException>(() => handler.Handle(Command(friendId), timeout.Token));

        await using var observer = new TodoDbContext(database.Options<TodoDbContext>());
        Assert.Empty(await observer.TodoItems.AsNoTracking().ToListAsync(timeout.Token));
        Assert.Empty(await observer.TodoItemShares.AsNoTracking().ToListAsync(timeout.Token));
        Assert.Empty(await observer.OutboxMessages.AsNoTracking().ToListAsync(timeout.Token));
    }

    [PostgresFact]
    public async Task CreateAsync_CommitsTaskAndCompleteCreationAndFeedEvents()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
        await using var context = new TodoDbContext(database.Options<TodoDbContext>());
        await TodoDatabaseStartup.EnsureReadyAsync(context, NullLogger.Instance, timeout.Token);
        var ownerId = Guid.NewGuid();
        var friendId = Guid.NewGuid();
        var outbox = new ControlledOutbox(new OutboxRepository(context));
        var handler = CreateHandler(context, ownerId, friendId, outbox);

        var result = await handler.Handle(Command(friendId), timeout.Token);

        Assert.True(result.IsSuccess);
        await using var observer = new TodoDbContext(database.Options<TodoDbContext>());
        var stored = Assert.Single(await observer.TodoItems.AsNoTracking()
            .Include(todo => todo.SharedWith).ToListAsync(timeout.Token));
        Assert.Equal(result.Value!.Id, stored.Id);
        Assert.Equal(ownerId, stored.UserId);
        Assert.Equal("Atomic creation", stored.Title);
        Assert.Equal("Synthetic task description", stored.Description);
        Assert.Equal(friendId, Assert.Single(stored.SharedWith).SharedWithUserId);
        var messages = await observer.OutboxMessages.AsNoTracking().ToListAsync(timeout.Token);
        Assert.Equal(2, messages.Count);
        Assert.All(messages, message => Assert.Equal(OutboxMessageStatus.Pending, message.Status));
        var created = JsonSerializer.Deserialize<TaskCreatedIntegrationEvent>(
            Assert.Single(messages, message => message.Type == typeof(TaskCreatedIntegrationEvent).AssemblyQualifiedName).Content)!;
        Assert.Equal((stored.Id, ownerId, "Audit Owner", stored.Description),
            (created.TaskId, created.OwnerId, created.OwnerName, created.Description));
        var feed = JsonSerializer.Deserialize<RealtimeSyncIntegrationEvent>(
            Assert.Single(messages, message => message.Type == typeof(RealtimeSyncIntegrationEvent).AssemblyQualifiedName).Content)!;
        Assert.Equal(RealtimeSyncAction.TaskCreated, feed.Action);
        Assert.Equal(stored.Id, feed.EntityId);
        Assert.Equal(Guid.Empty, feed.BranchTaskId);
        Assert.Equal(ownerId, feed.ActorId);
        // Feed signals include the owner; ActorId identifies the originating client echo.
        Assert.Equal(new[] { ownerId, friendId }.OrderBy(id => id),
            feed.AudienceUserIds.OrderBy(id => id));
        Assert.DoesNotContain(Guid.Empty, feed.AudienceUserIds);
        Assert.Equal(2, outbox.AttemptedMessages.Count);
    }

    private static CreateTodoCommand Command(Guid friendId) =>
        new(null, "Atomic creation", "Synthetic task description", null, null, null,
            SharedWithUserIds: new[] { friendId, friendId, Guid.Empty });

    private static CreateTodoCommandHandler CreateHandler(
        TodoDbContext context, Guid ownerId, Guid friendId, IOutboxRepository outbox)
    {
        var currentUser = new Mock<ICurrentUserContext>();
        currentUser.SetupGet(user => user.UserId).Returns(ownerId);
        currentUser.SetupGet(user => user.Name).Returns("Audit Owner");
        var friendships = new Mock<IFriendshipService>();
        friendships.Setup(service => service.GetFriendshipsAsync(ownerId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { new FriendshipInfo(friendId, DateTime.UtcNow.AddDays(-1)) });
        var mapper = new MapperConfiguration(
            configuration => configuration.AddProfile<TodoItemMappingProfile>(),
            NullLoggerFactory.Instance).CreateMapper();
        return new CreateTodoCommandHandler(
            new TodoRepository(context),
            new TodoUnitOfWork(context),
            mapper,
            NullLogger<CreateTodoCommandHandler>.Instance,
            currentUser.Object,
            Mock.Of<ICategoryGrpcClient>(),
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
