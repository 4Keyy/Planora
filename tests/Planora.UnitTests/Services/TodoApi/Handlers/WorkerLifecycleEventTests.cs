using AutoMapper;
using Planora.BuildingBlocks.Application.Context;
using Planora.BuildingBlocks.Application.Messaging.Events;
using Planora.BuildingBlocks.Application.Outbox;
using Planora.BuildingBlocks.Domain.Exceptions;
using Planora.BuildingBlocks.Domain.Interfaces;
using Planora.Todo.Application.DTOs;
using Planora.Todo.Application.Features.Todos.Commands.JoinTodo;
using Planora.Todo.Application.Features.Todos.Commands.LeaveTodo;
using Planora.Todo.Application.Services;
using Planora.Todo.Domain.Entities;
using Planora.Todo.Domain.Repositories;
using Microsoft.Extensions.Logging;
using Moq;

namespace Planora.UnitTests.Services.TodoApi.Handlers;

/// <summary>
/// After the comment timeline moved to the Collaboration service, worker lifecycle no longer
/// writes comments inline — it publishes <see cref="TaskActivityIntegrationEvent"/> through the
/// outbox. These tests pin that contract (the Collaboration consumer turns the event into the
/// "started working" / "left the task" system comment).
/// </summary>
public sealed class WorkerLifecycleEventTests
{
    [Fact]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Regression")]
    public async Task JoinTodo_PublishesStartedWorkingActivityEvent()
    {
        var owner = Guid.NewGuid();
        var joiner = Guid.NewGuid();
        var todo = TodoItem.Create(owner, "Public task", isPublic: true);
        var fixture = new Fixture(joiner);
        fixture.Repository
            .Setup(x => x.GetByIdWithIncludesTrackedAsync(todo.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(todo);
        fixture.Friendship
            .Setup(x => x.AreFriendsAsync(joiner, owner, It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);

        var result = await fixture.JoinHandler().Handle(new JoinTodoCommand(todo.Id), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Contains(todo.Workers, w => w.UserId == joiner);
        fixture.AssertActivityPublished(TaskActivityType.StartedWorking);
        fixture.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Regression")]
    public async Task LeaveTodo_PublishesLeftActivityEvent()
    {
        var owner = Guid.NewGuid();
        var worker = Guid.NewGuid();
        var todo = TodoItem.Create(owner, "Public task", isPublic: true);
        todo.AddWorker(worker);
        var fixture = new Fixture(worker);
        fixture.Repository
            .Setup(x => x.GetByIdWithIncludesTrackedAsync(todo.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(todo);

        var result = await fixture.LeaveHandler().Handle(new LeaveTodoCommand(todo.Id), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.DoesNotContain(todo.Workers, w => w.UserId == worker);
        fixture.AssertActivityPublished(TaskActivityType.Left);
        fixture.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    [Trait("TestType", "Security")]
    public async Task LeaveTodo_AsOwner_IsRejected()
    {
        var owner = Guid.NewGuid();
        var todo = TodoItem.Create(owner, "Task", isPublic: true);
        var fixture = new Fixture(owner);
        fixture.Repository
            .Setup(x => x.GetByIdWithIncludesTrackedAsync(todo.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(todo);

        await Assert.ThrowsAsync<BusinessRuleViolationException>(() =>
            fixture.LeaveHandler().Handle(new LeaveTodoCommand(todo.Id), CancellationToken.None));

        fixture.Outbox.Verify(x => x.AddAsync(It.IsAny<OutboxMessage>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    private sealed class Fixture
    {
        public Mock<ITodoRepository> Repository { get; } = new();
        public Mock<IUnitOfWork> UnitOfWork { get; } = new();
        public Mock<ICurrentUserContext> CurrentUser { get; } = new();
        public Mock<IFriendshipService> Friendship { get; } = new();
        public Mock<IOutboxRepository> Outbox { get; } = new();
        public Mock<IMapper> Mapper { get; } = new();
        private OutboxMessage? _captured;

        public Fixture(Guid userId)
        {
            CurrentUser.SetupGet(x => x.UserId).Returns(userId);
            CurrentUser.SetupGet(x => x.Name).Returns("Worker");
            UnitOfWork.Setup(x => x.SaveChangesAsync(It.IsAny<CancellationToken>())).ReturnsAsync(1);
            Repository.Setup(x => x.GetActiveWorkerTaskCountAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync(1);
            Outbox.Setup(x => x.AddAsync(It.IsAny<OutboxMessage>(), It.IsAny<CancellationToken>()))
                .Callback<OutboxMessage, CancellationToken>((m, _) => _captured = m)
                .Returns(Task.CompletedTask);
            Mapper.Setup(x => x.Map<TodoItemDto>(It.IsAny<TodoItem>()))
                .Returns(new TodoItemDto
                {
                    Id = Guid.NewGuid(),
                    UserId = Guid.NewGuid(),
                    Title = "t",
                    Status = "Todo",
                    Priority = "Medium",
                    IsPublic = true,
                    Hidden = false,
                    IsCompleted = false,
                    Tags = Array.Empty<string>(),
                    CreatedAt = DateTime.UtcNow,
                });
        }

        public void AssertActivityPublished(string activityType)
        {
            Assert.NotNull(_captured);
            Assert.Contains(nameof(TaskActivityIntegrationEvent), _captured!.Type);
            Assert.Contains(activityType, _captured.Content);
        }

        public JoinTodoCommandHandler JoinHandler() => new(
            Repository.Object, UnitOfWork.Object, Mapper.Object, CurrentUser.Object,
            Friendship.Object, Outbox.Object, Mock.Of<ILogger<JoinTodoCommandHandler>>());

        public LeaveTodoCommandHandler LeaveHandler() => new(
            Repository.Object, UnitOfWork.Object, CurrentUser.Object,
            Outbox.Object, Mock.Of<ILogger<LeaveTodoCommandHandler>>());
    }
}
