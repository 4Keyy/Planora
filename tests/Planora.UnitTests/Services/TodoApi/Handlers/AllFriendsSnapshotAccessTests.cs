using AutoMapper;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Planora.BuildingBlocks.Application.Context;
using Planora.BuildingBlocks.Application.Outbox;
using Planora.BuildingBlocks.Domain;
using Planora.BuildingBlocks.Domain.Interfaces;
using Planora.BuildingBlocks.Domain.Exceptions;
using Planora.Todo.Application.DTOs;
using Planora.Todo.Application.Features.Todos.Commands.JoinTodo;
using Planora.Todo.Application.Services;
using Planora.Todo.Domain.Entities;
using Planora.Todo.Domain.Repositories;

namespace Planora.UnitTests.Services.TodoApi.Handlers;

public sealed class AllFriendsSnapshotAccessTests
{
    [Fact]
    public async Task LegacyPublicTask_StillRequiresLiveFriendshipToJoin()
    {
        var owner = Guid.NewGuid();
        var stranger = Guid.NewGuid();
        var todo = TodoItem.Create(owner, "legacy", isPublic: true);
        var repository = new Mock<ITodoRepository>();
        repository.Setup(x => x.GetByIdWithIncludesTrackedAsync(todo.Id, It.IsAny<CancellationToken>())).ReturnsAsync(todo);
        var currentUser = new Mock<ICurrentUserContext>();
        currentUser.SetupGet(x => x.UserId).Returns(stranger);
        var mapper = new Mock<IMapper>();
        mapper.Setup(x => x.Map<TodoItemDto>(It.IsAny<object>())).Returns(new TodoItemDto { Id = todo.Id, UserId = owner, Title = "legacy", Status = "Todo", Priority = "Medium", IsPublic = true, Hidden = false, IsCompleted = false, Tags = [], CreatedAt = todo.CreatedAt });
        var friendships = new Mock<IFriendshipService>();
        friendships.Setup(x => x.GetFriendIdsAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>())).ReturnsAsync(Array.Empty<Guid>());
        var handler = new JoinTodoCommandHandler(repository.Object, Mock.Of<IUnitOfWork>(), mapper.Object,
            currentUser.Object, friendships.Object, Mock.Of<IOutboxRepository>(), NullLogger<JoinTodoCommandHandler>.Instance);

        await Assert.ThrowsAsync<ForbiddenException>(() => handler.Handle(new JoinTodoCommand(todo.Id), CancellationToken.None));
        Assert.Empty(todo.Workers);
    }
}
