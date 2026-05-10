using AutoMapper;
using Planora.BuildingBlocks.Domain.Exceptions;
using Planora.BuildingBlocks.Domain.Interfaces;
using Planora.BuildingBlocks.Infrastructure.Context;
using Planora.Todo.Application.DTOs;
using Planora.Todo.Application.Features.Todos.Commands.CreateTodo;
using Planora.Todo.Application.Features.Todos.Commands.UpdateTodo;
using Planora.Todo.Application.Features.Todos.Queries.GetTodoById;
using Planora.Todo.Application.Interfaces;
using Planora.Todo.Application.Services;
using Planora.Todo.Domain.Entities;
using Planora.Todo.Domain.Enums;
using Planora.Todo.Domain.Repositories;
using Microsoft.Extensions.Logging;
using Moq;

namespace Planora.UnitTests.Services.TodoApi.Handlers;

public class TodoOwnershipHandlerTests
{
    [Fact]
    public async Task CreateTodo_ShouldRejectSharingWithNonFriend_AndNotSave()
    {
        var ownerId = Guid.NewGuid();
        var friendId = Guid.NewGuid();
        var strangerId = Guid.NewGuid();
        var repositoryMock = new Mock<IRepository<TodoItem>>();
        var unitOfWorkMock = new Mock<IUnitOfWork>();
        var currentUserContextMock = CreateCurrentUserContext(ownerId);
        var categoryGrpcClientMock = new Mock<ICategoryGrpcClient>();
        var friendshipServiceMock = new Mock<IFriendshipService>();
        friendshipServiceMock
            .Setup(x => x.GetFriendIdsAsync(ownerId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { friendId });

        var handler = new CreateTodoCommandHandler(
            repositoryMock.Object,
            unitOfWorkMock.Object,
            Mock.Of<IMapper>(),
            Mock.Of<ILogger<CreateTodoCommandHandler>>(),
            currentUserContextMock.Object,
            categoryGrpcClientMock.Object,
            friendshipServiceMock.Object);

        var command = new CreateTodoCommand(
            null,
            "Shared task",
            null,
            null,
            null,
            null,
            TodoPriority.Medium,
            SharedWithUserIds: new[] { friendId, strangerId });

        await Assert.ThrowsAsync<ForbiddenException>(() => handler.Handle(command, CancellationToken.None));

        repositoryMock.Verify(
            x => x.AddAsync(It.IsAny<TodoItem>(), It.IsAny<CancellationToken>()),
            Times.Never);
        unitOfWorkMock.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Never);
        categoryGrpcClientMock.Verify(
            x => x.GetCategoryInfoAsync(It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    public async Task UpdateTodo_ShouldRejectCategoryNotOwnedByCurrentUser()
    {
        var ownerId = Guid.NewGuid();
        var todo = TodoItem.Create(ownerId, "Owned task");
        var foreignCategoryId = Guid.NewGuid();
        var repositoryMock = new Mock<ITodoRepository>();
        var unitOfWorkMock = new Mock<IUnitOfWork>();
        var currentUserContextMock = CreateCurrentUserContext(ownerId);
        var categoryGrpcClientMock = new Mock<ICategoryGrpcClient>();

        repositoryMock
            .Setup(x => x.GetByIdWithIncludesAsync(todo.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(todo);
        categoryGrpcClientMock
            .Setup(x => x.GetCategoryInfoAsync(foreignCategoryId, ownerId, It.IsAny<CancellationToken>()))
            .ReturnsAsync((CategoryInfo?)null);

        var handler = new UpdateTodoCommandHandler(
            repositoryMock.Object,
            unitOfWorkMock.Object,
            Mock.Of<IMapper>(),
            Mock.Of<ILogger<UpdateTodoCommandHandler>>(),
            currentUserContextMock.Object,
            categoryGrpcClientMock.Object,
            Mock.Of<IFriendshipService>());

        await Assert.ThrowsAsync<ForbiddenException>(() => handler.Handle(
            new UpdateTodoCommand(todo.Id, CategoryId: foreignCategoryId),
            CancellationToken.None));

        categoryGrpcClientMock.Verify(
            x => x.GetCategoryInfoAsync(foreignCategoryId, ownerId, It.IsAny<CancellationToken>()),
            Times.Once);
        repositoryMock.Verify(x => x.Update(It.IsAny<TodoItem>()), Times.Never);
        unitOfWorkMock.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task GetTodoById_ShouldRejectSharedTodo_WhenFriendshipNoLongerExists()
    {
        var ownerId = Guid.NewGuid();
        var viewerId = Guid.NewGuid();
        var todo = TodoItem.Create(
            ownerId,
            "Shared task",
            isPublic: true,
            sharedWithUserIds: new[] { viewerId });
        var repositoryMock = new Mock<ITodoRepository>();
        var currentUserContextMock = CreateCurrentUserContext(viewerId);
        var friendshipServiceMock = new Mock<IFriendshipService>();
        var categoryGrpcClientMock = new Mock<ICategoryGrpcClient>();
        var viewerPreferenceRepositoryMock = new Mock<IUserTodoViewPreferenceRepository>();

        repositoryMock
            .Setup(x => x.GetByIdWithIncludesAsync(todo.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(todo);
        friendshipServiceMock
            .Setup(x => x.AreFriendsAsync(viewerId, ownerId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(false);

        var handler = new GetTodoByIdQueryHandler(
            repositoryMock.Object,
            currentUserContextMock.Object,
            Mock.Of<IMapper>(),
            Mock.Of<ILogger<GetTodoByIdQueryHandler>>(),
            friendshipServiceMock.Object,
            categoryGrpcClientMock.Object,
            viewerPreferenceRepositoryMock.Object);

        await Assert.ThrowsAsync<ForbiddenException>(() => handler.Handle(
            new GetTodoByIdQuery(todo.Id),
            CancellationToken.None));

        viewerPreferenceRepositoryMock.Verify(
            x => x.GetAsync(It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<CancellationToken>()),
            Times.Never);
        categoryGrpcClientMock.Verify(
            x => x.GetCategoryInfoAsync(It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    public async Task UpdateTodo_ShouldRejectSharedMetadataEdit_EvenWhenUsersAreFriends()
    {
        var ownerId = Guid.NewGuid();
        var viewerId = Guid.NewGuid();
        var todo = TodoItem.Create(
            ownerId,
            "Shared task",
            isPublic: true,
            sharedWithUserIds: new[] { viewerId });
        var repositoryMock = new Mock<ITodoRepository>();
        var unitOfWorkMock = new Mock<IUnitOfWork>();
        var currentUserContextMock = CreateCurrentUserContext(viewerId);
        var friendshipServiceMock = new Mock<IFriendshipService>();

        repositoryMock
            .Setup(x => x.GetByIdWithIncludesAsync(todo.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(todo);
        friendshipServiceMock
            .Setup(x => x.AreFriendsAsync(viewerId, ownerId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);

        var handler = new UpdateTodoCommandHandler(
            repositoryMock.Object,
            unitOfWorkMock.Object,
            Mock.Of<IMapper>(),
            Mock.Of<ILogger<UpdateTodoCommandHandler>>(),
            currentUserContextMock.Object,
            Mock.Of<ICategoryGrpcClient>(),
            friendshipServiceMock.Object);

        await Assert.ThrowsAsync<ForbiddenException>(() => handler.Handle(
            new UpdateTodoCommand(todo.Id, Title: "Changed by viewer"),
            CancellationToken.None));

        repositoryMock.Verify(x => x.Update(It.IsAny<TodoItem>()), Times.Never);
        unitOfWorkMock.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    private static Mock<ICurrentUserContext> CreateCurrentUserContext(Guid userId)
    {
        var currentUserContextMock = new Mock<ICurrentUserContext>();
        currentUserContextMock.SetupGet(x => x.UserId).Returns(userId);
        currentUserContextMock.SetupGet(x => x.IsAuthenticated).Returns(true);
        return currentUserContextMock;
    }
}
