using System.Linq.Expressions;
using AutoMapper;
using Planora.BuildingBlocks.Domain.Exceptions;
using Planora.BuildingBlocks.Domain.Interfaces;
using Planora.BuildingBlocks.Infrastructure.Context;
using Planora.Todo.Application.DTOs;
using Planora.Todo.Application.Features.Todos.Queries.GetPublicTodos;
using Planora.Todo.Application.Features.Todos.Queries.GetTodoById;
using Planora.Todo.Application.Features.Todos.Queries.GetUserTodos;
using Planora.Todo.Application.Interfaces;
using Planora.Todo.Application.Services;
using Planora.Todo.Domain.Entities;
using Planora.Todo.Domain.Enums;
using Planora.Todo.Domain.Repositories;
using Planora.Todo.Domain.ValueObjects;
using Microsoft.Extensions.Logging;
using Moq;

namespace Planora.UnitTests.Services.TodoApi.Handlers;

public class TodoQueryHandlerTests
{
    [Fact]
    public async Task GetUserTodos_ShouldRejectMissingUserContext()
    {
        var fixture = new TodoQueryFixture(Guid.Empty);

        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            fixture.CreateGetUserTodosHandler().Handle(
                new GetUserTodosQuery(null),
                CancellationToken.None));

        fixture.Repository.Verify(
            x => x.GetPagedWithIncludesAsync(
                It.IsAny<Expression<Func<TodoItem, bool>>>(),
                It.IsAny<int>(),
                It.IsAny<int>(),
                It.IsAny<bool>(),
                It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    public async Task GetUserTodos_ShouldPageOwnAndFriendTodos_FilterByViewerCategory_AndEnrichOnce()
    {
        var userId = Guid.NewGuid();
        var friendId = Guid.NewGuid();
        var categoryId = Guid.NewGuid();
        var fixture = new TodoQueryFixture(userId);
        var ownTodo = TodoItem.Create(userId, "Own task", categoryId: categoryId);
        var sharedTodo = TodoItem.Create(friendId, "Shared task", isPublic: true, sharedWithUserIds: new[] { userId });
        var strangerTodo = TodoItem.Create(Guid.NewGuid(), "Stranger task", categoryId: categoryId);
        bool? sortCompletedByCompletionTime = null;

        fixture.FriendshipService
            .Setup(x => x.GetFriendIdsAsync(userId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { friendId });
        fixture.ViewerPreferences
            .Setup(x => x.GetTodoIdsByViewerCategoryAsync(userId, categoryId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<Guid> { sharedTodo.Id });
        fixture.ViewerPreferences
            .Setup(x => x.GetByViewerIdForTodosAsync(
                userId,
                It.IsAny<IReadOnlyCollection<Guid>>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<Guid, UserTodoViewPreference>
            {
                [sharedTodo.Id] = new()
                {
                    ViewerId = userId,
                    TodoItemId = sharedTodo.Id,
                    ViewerCategoryId = categoryId,
                    HiddenByViewer = false
                }
            });
        fixture.Repository
            .Setup(x => x.GetPagedWithIncludesAsync(
                It.IsAny<Expression<Func<TodoItem, bool>>>(),
                2,
                10,
                It.IsAny<bool>(),
                It.IsAny<CancellationToken>()))
            .Callback<Expression<Func<TodoItem, bool>>, int, int, bool, CancellationToken>(
                (_, _, _, sortFlag, _) => sortCompletedByCompletionTime = sortFlag)
            .ReturnsAsync((Expression<Func<TodoItem, bool>> predicate, int _, int _, bool _, CancellationToken _) =>
            {
                var matches = new[] { ownTodo, sharedTodo, strangerTodo }
                    .Where(predicate.Compile())
                    .ToList();
                return (matches, matches.Count);
            });
        fixture.CategoryGrpcClient
            .Setup(x => x.GetCategoryInfoAsync(categoryId, userId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new CategoryInfo(categoryId, userId, "Work", "#123456", "briefcase"));

        var result = await fixture.CreateGetUserTodosHandler().Handle(
            new GetUserTodosQuery(userId, PageNumber: 2, PageSize: 10, CategoryId: categoryId),
            CancellationToken.None);

        Assert.Equal(2, result.Items.Count);
        Assert.Equal(2, result.TotalCount);
        Assert.All(result.Items, item =>
        {
            Assert.Equal(categoryId, item.CategoryId);
            Assert.Equal("Work", item.CategoryName);
            Assert.Equal("#123456", item.CategoryColor);
            Assert.Equal("briefcase", item.CategoryIcon);
        });
        Assert.DoesNotContain(result.Items, item => item.Id == strangerTodo.Id);
        Assert.False(sortCompletedByCompletionTime);
        fixture.CategoryGrpcClient.Verify(
            x => x.GetCategoryInfoAsync(categoryId, userId, It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    [Trait("TestType", "Regression")]
    public async Task GetUserTodos_ShouldIncludePublicFriendTodosWithoutDirectShare()
    {
        var userId = Guid.NewGuid();
        var friendId = Guid.NewGuid();
        var strangerId = Guid.NewGuid();
        var fixture = new TodoQueryFixture(userId);
        var publicFriendTodo = TodoItem.Create(friendId, "Public friend task", isPublic: true);
        var privateFriendTodo = TodoItem.Create(friendId, "Private friend task");
        var publicStrangerTodo = TodoItem.Create(strangerId, "Public stranger task", isPublic: true);

        fixture.FriendshipService
            .Setup(x => x.GetFriendIdsAsync(userId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { friendId });
        fixture.Repository
            .Setup(x => x.GetPagedWithIncludesAsync(
                It.IsAny<Expression<Func<TodoItem, bool>>>(),
                1,
                10,
                It.IsAny<bool>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync((Expression<Func<TodoItem, bool>> predicate, int _, int _, bool _, CancellationToken _) =>
            {
                var matches = new[] { publicFriendTodo, privateFriendTodo, publicStrangerTodo }
                    .Where(predicate.Compile())
                    .ToList();
                return (matches, matches.Count);
            });

        var result = await fixture.CreateGetUserTodosHandler().Handle(
            new GetUserTodosQuery(userId),
            CancellationToken.None);

        var dto = Assert.Single(result.Items);
        Assert.Equal(publicFriendTodo.Id, dto.Id);
        Assert.True(dto.IsPublic);
        Assert.Empty(dto.SharedWithUserIds);
    }

    [Fact]
    public async Task GetUserTodos_ShouldReturnMinimalHiddenSharedTodo_AndUseCompletedSort()
    {
        var userId = Guid.NewGuid();
        var friendId = Guid.NewGuid();
        var categoryId = Guid.NewGuid();
        var fixture = new TodoQueryFixture(userId);
        var sharedTodo = TodoItem.Create(
            friendId,
            "Hidden shared task",
            description: "Sensitive description",
            categoryId: Guid.NewGuid(),
            priority: TodoPriority.Urgent,
            isPublic: true,
            sharedWithUserIds: new[] { userId });
        sharedTodo.AddTag("secret", friendId);
        bool? sortCompletedByCompletionTime = null;

        fixture.FriendshipService
            .Setup(x => x.GetFriendIdsAsync(userId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { friendId });
        fixture.ViewerPreferences
            .Setup(x => x.GetByViewerIdForTodosAsync(
                userId,
                It.IsAny<IReadOnlyCollection<Guid>>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<Guid, UserTodoViewPreference>
            {
                [sharedTodo.Id] = new()
                {
                    ViewerId = userId,
                    TodoItemId = sharedTodo.Id,
                    HiddenByViewer = true,
                    ViewerCategoryId = categoryId
                }
            });
        fixture.Repository
            .Setup(x => x.GetPagedWithIncludesAsync(
                It.IsAny<Expression<Func<TodoItem, bool>>>(),
                1,
                20,
                It.IsAny<bool>(),
                It.IsAny<CancellationToken>()))
            .Callback<Expression<Func<TodoItem, bool>>, int, int, bool, CancellationToken>(
                (_, _, _, sortFlag, _) => sortCompletedByCompletionTime = sortFlag)
            .ReturnsAsync(((IReadOnlyList<TodoItem>)new[] { sharedTodo }, 1));
        fixture.CategoryGrpcClient
            .Setup(x => x.GetCategoryInfoAsync(categoryId, userId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new CategoryInfo(categoryId, userId, "Viewer", "#654321", "eye"));

        var result = await fixture.CreateGetUserTodosHandler().Handle(
            new GetUserTodosQuery(userId, PageSize: 20, IsCompleted: true),
            CancellationToken.None);

        var dto = Assert.Single(result.Items);
        Assert.True(dto.Hidden);
        Assert.Equal("Hidden task", dto.Title);
        Assert.Equal(Guid.Empty, dto.UserId);
        Assert.Null(dto.Description);
        Assert.Empty(dto.Tags);
        Assert.Empty(dto.SharedWithUserIds);
        Assert.Equal("Urgent", dto.Priority);
        Assert.True(dto.IsPublic);
        Assert.True(dto.HasSharedAudience);
        Assert.True(dto.IsVisuallyUrgent);
        Assert.Null(dto.DueDate);
        Assert.Null(dto.ExpectedDate);
        Assert.Null(dto.ActualDate);
        Assert.Null(dto.CompletedAt);
        Assert.Null(dto.IsOnTime);
        Assert.Null(dto.Delay);
        Assert.Equal(categoryId, dto.CategoryId);
        Assert.Equal("Viewer", dto.CategoryName);
        Assert.True(sortCompletedByCompletionTime);
    }

    [Fact]
    public async Task GetUserTodos_ShouldKeepTodo_WhenCategoryGrpcFails()
    {
        var userId = Guid.NewGuid();
        var categoryId = Guid.NewGuid();
        var fixture = new TodoQueryFixture(userId);
        var todo = TodoItem.Create(userId, "Own task", categoryId: categoryId);

        fixture.FriendshipService
            .Setup(x => x.GetFriendIdsAsync(userId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(Array.Empty<Guid>());
        fixture.Repository
            .Setup(x => x.GetPagedWithIncludesAsync(
                It.IsAny<Expression<Func<TodoItem, bool>>>(),
                1,
                10,
                It.IsAny<bool>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync(((IReadOnlyList<TodoItem>)new[] { todo }, 1));
        fixture.CategoryGrpcClient
            .Setup(x => x.GetCategoryInfoAsync(categoryId, userId, It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("category service unavailable"));

        var result = await fixture.CreateGetUserTodosHandler().Handle(
            new GetUserTodosQuery(userId),
            CancellationToken.None);

        var dto = Assert.Single(result.Items);
        Assert.Equal(todo.Id, dto.Id);
        Assert.Equal(categoryId, dto.CategoryId);
        Assert.Null(dto.CategoryName);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task GetUserTodos_ShouldParseStatusFilterAndReturnHiddenOwnPrivateTodoWithOwnerData()
    {
        var userId = Guid.NewGuid();
        var fixture = new TodoQueryFixture(userId);
        var hiddenTodo = TodoItem.Create(userId, "Hidden own task");
        hiddenTodo.AddTag("private", userId);
        hiddenTodo.SetHidden(true, userId);
        var completedTodo = TodoItem.Create(userId, "Completed task");
        completedTodo.MarkAsDone(userId);
        bool? sortCompletedByCompletionTime = null;

        fixture.FriendshipService
            .Setup(x => x.GetFriendIdsAsync(userId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(Array.Empty<Guid>());
        fixture.Repository
            .Setup(x => x.GetPagedWithIncludesAsync(
                It.IsAny<Expression<Func<TodoItem, bool>>>(),
                1,
                10,
                It.IsAny<bool>(),
                It.IsAny<CancellationToken>()))
            .Callback<Expression<Func<TodoItem, bool>>, int, int, bool, CancellationToken>(
                (_, _, _, sortFlag, _) => sortCompletedByCompletionTime = sortFlag)
            .ReturnsAsync((Expression<Func<TodoItem, bool>> predicate, int _, int _, bool _, CancellationToken _) =>
            {
                var items = new[] { hiddenTodo, completedTodo }
                    .Where(predicate.Compile())
                    .ToList();
                return (items, items.Count);
            });

        var result = await fixture.CreateGetUserTodosHandler().Handle(
            new GetUserTodosQuery(null, Status: "todo,unknown"),
            CancellationToken.None);

        var dto = Assert.Single(result.Items);
        Assert.Equal(hiddenTodo.Id, dto.Id);
        Assert.Equal(userId, dto.UserId);
        Assert.Equal("Hidden own task", dto.Title);
        Assert.True(dto.Hidden);
        Assert.Equal("Todo", dto.Status);
        Assert.Equal("Medium", dto.Priority);
        Assert.False(dto.IsPublic);
        Assert.False(dto.IsCompleted);
        Assert.Empty(dto.Tags);
        Assert.Empty(dto.SharedWithUserIds);
        Assert.Null(dto.CategoryId);
        Assert.Null(dto.CategoryName);
        Assert.False(sortCompletedByCompletionTime);
        fixture.CategoryGrpcClient.Verify(
            x => x.GetCategoryInfoAsync(It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    public async Task GetTodoById_ShouldReturnOwnerTodoWithCategoryEnrichment()
    {
        var userId = Guid.NewGuid();
        var categoryId = Guid.NewGuid();
        var fixture = new TodoQueryFixture(userId);
        var todo = TodoItem.Create(userId, "Owner task", categoryId: categoryId);
        fixture.Repository.Setup(x => x.GetByIdWithIncludesAsync(todo.Id, It.IsAny<CancellationToken>())).ReturnsAsync(todo);
        fixture.ViewerPreferences.Setup(x => x.GetAsync(userId, todo.Id, It.IsAny<CancellationToken>())).ReturnsAsync((UserTodoViewPreference?)null);
        fixture.CategoryGrpcClient
            .Setup(x => x.GetCategoryInfoAsync(categoryId, userId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new CategoryInfo(categoryId, userId, "Personal", "#abcdef", "home"));

        var result = await fixture.CreateGetTodoByIdHandler().Handle(
            new GetTodoByIdQuery(todo.Id),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal("Owner task", result.Value!.Title);
        Assert.False(result.Value.Hidden);
        Assert.Equal("Personal", result.Value.CategoryName);
    }

    [Fact]
    public async Task GetTodoById_ShouldReturnHiddenSharedTodoWithMinimalData()
    {
        var ownerId = Guid.NewGuid();
        var userId = Guid.NewGuid();
        var categoryId = Guid.NewGuid();
        var fixture = new TodoQueryFixture(userId);
        var todo = TodoItem.Create(ownerId, "Shared task", description: "Private", priority: TodoPriority.Urgent, isPublic: true, sharedWithUserIds: new[] { userId });
        todo.AddTag("private", ownerId);
        fixture.Repository.Setup(x => x.GetByIdWithIncludesAsync(todo.Id, It.IsAny<CancellationToken>())).ReturnsAsync(todo);
        fixture.FriendshipService.Setup(x => x.AreFriendsAsync(userId, ownerId, It.IsAny<CancellationToken>())).ReturnsAsync(true);
        fixture.ViewerPreferences.Setup(x => x.GetAsync(userId, todo.Id, It.IsAny<CancellationToken>())).ReturnsAsync(new UserTodoViewPreference
        {
            ViewerId = userId,
            TodoItemId = todo.Id,
            HiddenByViewer = true,
            ViewerCategoryId = categoryId
        });
        fixture.CategoryGrpcClient
            .Setup(x => x.GetCategoryInfoAsync(categoryId, userId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new CategoryInfo(categoryId, userId, "Archive", "#eeeeee", "archive"));

        var result = await fixture.CreateGetTodoByIdHandler().Handle(
            new GetTodoByIdQuery(todo.Id),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.True(result.Value!.Hidden);
        Assert.Equal("Hidden task", result.Value.Title);
        Assert.Equal(Guid.Empty, result.Value.UserId);
        Assert.Null(result.Value.Description);
        Assert.Equal(string.Empty, result.Value.Status);
        Assert.Equal("Urgent", result.Value.Priority);
        Assert.True(result.Value.IsPublic);
        Assert.True(result.Value.HasSharedAudience);
        Assert.True(result.Value.IsVisuallyUrgent);
        Assert.False(result.Value.IsCompleted);
        Assert.Equal(DateTime.MinValue, result.Value.CreatedAt);
        Assert.Empty(result.Value.Tags);
        Assert.Empty(result.Value.SharedWithUserIds);
        Assert.Null(result.Value.DueDate);
        Assert.Null(result.Value.ExpectedDate);
        Assert.Null(result.Value.ActualDate);
        Assert.Null(result.Value.CompletedAt);
        Assert.Null(result.Value.IsOnTime);
        Assert.Null(result.Value.Delay);
        Assert.Equal("Archive", result.Value.CategoryName);
    }

    [Fact]
    [Trait("TestType", "Regression")]
    public async Task GetTodoById_ShouldReturnPublicFriendTodoWithoutDirectShare()
    {
        var ownerId = Guid.NewGuid();
        var viewerId = Guid.NewGuid();
        var fixture = new TodoQueryFixture(viewerId);
        var todo = TodoItem.Create(ownerId, "Public friend task", isPublic: true);
        fixture.Repository.Setup(x => x.GetByIdWithIncludesAsync(todo.Id, It.IsAny<CancellationToken>())).ReturnsAsync(todo);
        fixture.FriendshipService.Setup(x => x.AreFriendsAsync(viewerId, ownerId, It.IsAny<CancellationToken>())).ReturnsAsync(true);
        fixture.ViewerPreferences.Setup(x => x.GetAsync(viewerId, todo.Id, It.IsAny<CancellationToken>())).ReturnsAsync((UserTodoViewPreference?)null);

        var result = await fixture.CreateGetTodoByIdHandler().Handle(
            new GetTodoByIdQuery(todo.Id),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(todo.Id, result.Value!.Id);
        Assert.True(result.Value.IsPublic);
        Assert.Empty(result.Value.SharedWithUserIds);
        fixture.FriendshipService.Verify(
            x => x.AreFriendsAsync(viewerId, ownerId, It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    [Trait("TestType", "Resilience")]
    [Trait("TestType", "Regression")]
    public async Task GetTodoById_ShouldReturnHiddenSharedTodo_WhenHiddenCategoryGrpcFails()
    {
        var ownerId = Guid.NewGuid();
        var userId = Guid.NewGuid();
        var categoryId = Guid.NewGuid();
        var fixture = new TodoQueryFixture(userId);
        var todo = TodoItem.Create(ownerId, "Hidden shared", isPublic: true, sharedWithUserIds: new[] { userId });
        fixture.Repository.Setup(x => x.GetByIdWithIncludesAsync(todo.Id, It.IsAny<CancellationToken>())).ReturnsAsync(todo);
        fixture.FriendshipService.Setup(x => x.AreFriendsAsync(userId, ownerId, It.IsAny<CancellationToken>())).ReturnsAsync(true);
        fixture.ViewerPreferences.Setup(x => x.GetAsync(userId, todo.Id, It.IsAny<CancellationToken>())).ReturnsAsync(new UserTodoViewPreference
        {
            ViewerId = userId,
            TodoItemId = todo.Id,
            HiddenByViewer = true,
            ViewerCategoryId = categoryId
        });
        fixture.CategoryGrpcClient
            .Setup(x => x.GetCategoryInfoAsync(categoryId, userId, It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("category service unavailable"));

        var result = await fixture.CreateGetTodoByIdHandler().Handle(
            new GetTodoByIdQuery(todo.Id),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.True(result.Value!.Hidden);
        Assert.Equal("Hidden task", result.Value.Title);
        Assert.Equal(categoryId, result.Value.CategoryId);
        Assert.Null(result.Value.CategoryName);
        Assert.Null(result.Value.CategoryColor);
        Assert.Null(result.Value.CategoryIcon);
    }

    [Fact]
    [Trait("TestType", "Resilience")]
    [Trait("TestType", "Regression")]
    public async Task GetTodoById_ShouldReturnFullTodo_WhenCategoryGrpcFails()
    {
        var userId = Guid.NewGuid();
        var categoryId = Guid.NewGuid();
        var fixture = new TodoQueryFixture(userId);
        var todo = TodoItem.Create(userId, "Owner task", categoryId: categoryId);
        fixture.Repository.Setup(x => x.GetByIdWithIncludesAsync(todo.Id, It.IsAny<CancellationToken>())).ReturnsAsync(todo);
        fixture.ViewerPreferences.Setup(x => x.GetAsync(userId, todo.Id, It.IsAny<CancellationToken>())).ReturnsAsync((UserTodoViewPreference?)null);
        fixture.CategoryGrpcClient
            .Setup(x => x.GetCategoryInfoAsync(categoryId, userId, It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("category service unavailable"));

        var result = await fixture.CreateGetTodoByIdHandler().Handle(
            new GetTodoByIdQuery(todo.Id),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal("Owner task", result.Value!.Title);
        Assert.Equal(categoryId, result.Value.CategoryId);
        Assert.Null(result.Value.CategoryName);
        Assert.Null(result.Value.CategoryColor);
        Assert.Null(result.Value.CategoryIcon);
    }

    [Fact]
    public async Task GetTodoById_ShouldThrowNotFound_AndForbiddenForNonSharedTodo()
    {
        var userId = Guid.NewGuid();
        var ownerId = Guid.NewGuid();
        var fixture = new TodoQueryFixture(userId);
        var missingId = Guid.NewGuid();
        fixture.Repository.Setup(x => x.GetByIdWithIncludesAsync(missingId, It.IsAny<CancellationToken>()))
            .ReturnsAsync((TodoItem?)null);

        await Assert.ThrowsAsync<EntityNotFoundException>(() =>
            fixture.CreateGetTodoByIdHandler().Handle(new GetTodoByIdQuery(missingId), CancellationToken.None));

        var privateTodo = TodoItem.Create(ownerId, "Private task");
        fixture.Repository.Setup(x => x.GetByIdWithIncludesAsync(privateTodo.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(privateTodo);

        await Assert.ThrowsAsync<ForbiddenException>(() =>
            fixture.CreateGetTodoByIdHandler().Handle(new GetTodoByIdQuery(privateTodo.Id), CancellationToken.None));

        var publicNonFriendTodo = TodoItem.Create(ownerId, "Public non-friend task", isPublic: true);
        fixture.Repository.Setup(x => x.GetByIdWithIncludesAsync(publicNonFriendTodo.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(publicNonFriendTodo);
        fixture.FriendshipService.Setup(x => x.AreFriendsAsync(userId, ownerId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(false);

        await Assert.ThrowsAsync<ForbiddenException>(() =>
            fixture.CreateGetTodoByIdHandler().Handle(new GetTodoByIdQuery(publicNonFriendTodo.Id), CancellationToken.None));
    }

    [Fact]
    public async Task GetPublicTodos_ShouldRequireUserContext_AndRejectNonFriendFilter()
    {
        var fixture = new TodoQueryFixture(Guid.Empty);
        var authRequired = await fixture.CreateGetPublicTodosHandler().Handle(
            new GetPublicTodosQuery(),
            CancellationToken.None);
        Assert.True(authRequired.IsFailure);
        Assert.Equal("AUTH_REQUIRED", authRequired.Error!.Code);

        var userId = Guid.NewGuid();
        var friendFixture = new TodoQueryFixture(userId);
        friendFixture.FriendshipService
            .Setup(x => x.GetFriendIdsAsync(userId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(Array.Empty<Guid>());
        friendFixture.ViewerPreferences
            .Setup(x => x.GetHiddenTodoIdsAsync(userId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<Guid>());

        var notFriends = await friendFixture.CreateGetPublicTodosHandler().Handle(
            new GetPublicTodosQuery(FriendId: Guid.NewGuid()),
            CancellationToken.None);

        Assert.True(notFriends.IsFailure);
        Assert.Equal("NOT_FRIENDS", notFriends.Error!.Code);
    }

    [Fact]
    public async Task GetPublicTodos_ShouldReturnFriendAndAllFriendSharedTodosWithoutCategoryId()
    {
        var userId = Guid.NewGuid();
        var friendId = Guid.NewGuid();
        var otherFriendId = Guid.NewGuid();
        var hiddenTodoId = Guid.NewGuid();
        var friendTodo = TodoItem.Create(friendId, "Friend task", categoryId: Guid.NewGuid(), isPublic: true);
        var otherFriendTodo = TodoItem.Create(otherFriendId, "Other friend task", categoryId: Guid.NewGuid(), isPublic: true, sharedWithUserIds: new[] { userId });
        var privateFriendTodo = TodoItem.Create(friendId, "Private friend task");
        var fixture = new TodoQueryFixture(userId);

        fixture.FriendshipService
            .Setup(x => x.GetFriendIdsAsync(userId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { friendId, otherFriendId });
        fixture.ViewerPreferences
            .Setup(x => x.GetHiddenTodoIdsAsync(userId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<Guid> { hiddenTodoId });
        fixture.Repository
            .Setup(x => x.FindPageWithIncludesAsync(
                It.IsAny<Expression<Func<TodoItem, bool>>>(),
                It.IsAny<bool>(),
                It.IsAny<int>(),
                It.IsAny<int>(),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync((Expression<Func<TodoItem, bool>> predicate, bool _, int _, int _, CancellationToken _) =>
            {
                var items = new[] { friendTodo, otherFriendTodo, privateFriendTodo }
                    .Where(predicate.Compile())
                    .ToList();
                return ((IReadOnlyList<TodoItem>)items, items.Count);
            });

        var friendOnly = await fixture.CreateGetPublicTodosHandler().Handle(
            new GetPublicTodosQuery(FriendId: friendId),
            CancellationToken.None);
        var friendDto = Assert.Single(friendOnly.Value!.Items);
        Assert.Equal(friendTodo.Id, friendDto.Id);
        Assert.Null(friendDto.CategoryId);

        var allFriends = await fixture.CreateGetPublicTodosHandler().Handle(
            new GetPublicTodosQuery(),
            CancellationToken.None);
        Assert.Equal(2, allFriends.Value!.Items.Count);
        Assert.All(allFriends.Value.Items, item => Assert.Null(item.CategoryId));
    }

    [Fact]
    public async Task GetPublicTodos_ShouldReturnEmptyWithoutFriends_AndFailureWhenRepositoryThrows()
    {
        var userId = Guid.NewGuid();
        var fixture = new TodoQueryFixture(userId);
        fixture.FriendshipService
            .Setup(x => x.GetFriendIdsAsync(userId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(Array.Empty<Guid>());
        fixture.ViewerPreferences
            .Setup(x => x.GetHiddenTodoIdsAsync(userId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<Guid>());

        var empty = await fixture.CreateGetPublicTodosHandler().Handle(
            new GetPublicTodosQuery(),
            CancellationToken.None);
        Assert.True(empty.IsSuccess);
        Assert.Empty(empty.Value!.Items);

        var failing = new TodoQueryFixture(userId);
        failing.FriendshipService
            .Setup(x => x.GetFriendIdsAsync(userId, It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("auth service unavailable"));

        var failed = await failing.CreateGetPublicTodosHandler().Handle(
            new GetPublicTodosQuery(),
            CancellationToken.None);
        Assert.True(failed.IsFailure);
        Assert.Equal("QUERY_FAILED", failed.Error!.Code);
    }

    private sealed class TodoQueryFixture
    {
        public Mock<ITodoRepository> Repository { get; } = new();
        public Mock<IRepository<TodoItem>> GenericRepository { get; } = new();
        public Mock<ICurrentUserContext> CurrentUserContext { get; } = new();
        public Mock<ICategoryGrpcClient> CategoryGrpcClient { get; } = new();
        public Mock<IFriendshipService> FriendshipService { get; } = new();
        public Mock<IUserTodoViewPreferenceRepository> ViewerPreferences { get; } = new();
        private readonly Mock<IMapper> _mapper = new();

        public TodoQueryFixture(Guid userId)
        {
            CurrentUserContext.SetupGet(x => x.UserId).Returns(userId);
            CurrentUserContext.SetupGet(x => x.IsAuthenticated).Returns(userId != Guid.Empty);
            _mapper.Setup(x => x.Map<TodoItemDto>(It.IsAny<TodoItem>()))
                .Returns((TodoItem item) => ToDto(item));
            ViewerPreferences
                .Setup(x => x.GetByViewerIdForTodosAsync(
                    It.IsAny<Guid>(),
                    It.IsAny<IReadOnlyCollection<Guid>>(),
                    It.IsAny<CancellationToken>()))
                .ReturnsAsync(new Dictionary<Guid, UserTodoViewPreference>());
            ViewerPreferences
                .Setup(x => x.GetTodoIdsByViewerCategoryAsync(
                    It.IsAny<Guid>(),
                    It.IsAny<Guid>(),
                    It.IsAny<CancellationToken>()))
                .ReturnsAsync(new List<Guid>());
        }

        public GetUserTodosQueryHandler CreateGetUserTodosHandler()
            => new(
                Repository.Object,
                _mapper.Object,
                Mock.Of<ILogger<GetUserTodosQueryHandler>>(),
                CurrentUserContext.Object,
                CategoryGrpcClient.Object,
                FriendshipService.Object,
                ViewerPreferences.Object);

        public GetTodoByIdQueryHandler CreateGetTodoByIdHandler()
            => new(
                Repository.Object,
                CurrentUserContext.Object,
                _mapper.Object,
                Mock.Of<ILogger<GetTodoByIdQueryHandler>>(),
                FriendshipService.Object,
                CategoryGrpcClient.Object,
                ViewerPreferences.Object);

        public GetPublicTodosQueryHandler CreateGetPublicTodosHandler()
            => new(
                Repository.Object,
                _mapper.Object,
                Mock.Of<ILogger<GetPublicTodosQueryHandler>>(),
                CurrentUserContext.Object,
                FriendshipService.Object,
                ViewerPreferences.Object);
    }

    private static TodoItemDto ToDto(TodoItem item)
        => new()
        {
            Id = item.Id,
            UserId = item.UserId,
            Title = item.Title,
            Description = item.Description,
            Status = item.Status.Display(),
            CategoryId = item.CategoryId,
            DueDate = item.DueDate,
            ExpectedDate = item.ExpectedDate,
            ActualDate = item.ActualDate,
            Priority = item.Priority.ToString(),
            IsPublic = item.IsPublic,
            Hidden = item.Hidden,
            IsCompleted = item.IsCompleted,
            CompletedAt = item.CompletedAt,
            IsOnTime = item.IsOnTime(),
            Delay = item.GetDelay(),
            Tags = item.Tags.Select(tag => tag.Name).ToList(),
            CreatedAt = item.CreatedAt,
            UpdatedAt = item.UpdatedAt,
            SharedWithUserIds = item.SharedWith.Select(share => share.SharedWithUserId).ToList()
        };
}
