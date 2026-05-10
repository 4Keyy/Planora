using AutoMapper;
using Planora.BuildingBlocks.Domain.Exceptions;
using Planora.BuildingBlocks.Domain.Interfaces;
using Planora.BuildingBlocks.Infrastructure.Context;
using Planora.Todo.Application.DTOs;
using Planora.Todo.Application.Features.Todos.Commands.CreateTodo;
using Planora.Todo.Application.Features.Todos.Commands.DeleteTodo;
using Planora.Todo.Application.Features.Todos.Commands.SetTodoHidden;
using Planora.Todo.Application.Features.Todos.Commands.SetViewerPreference;
using Planora.Todo.Application.Features.Todos.Commands.UpdateTodo;
using Planora.Todo.Application.Interfaces;
using Planora.Todo.Application.Services;
using Planora.Todo.Domain.Entities;
using Planora.Todo.Domain.Enums;
using Planora.Todo.Domain.Repositories;
using Planora.Todo.Domain.ValueObjects;
using Microsoft.Extensions.Logging;
using Moq;

namespace Planora.UnitTests.Services.TodoApi.Handlers;

public class TodoCommandHandlerExpandedTests
{
    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task CreateTodo_ShouldCreateCategorizedSharedTask_OnlyForFriends()
    {
        var userId = Guid.NewGuid();
        var friendId = Guid.NewGuid();
        var categoryId = Guid.NewGuid();
        var fixture = new TodoCommandFixture(userId);
        TodoItem? added = null;
        fixture.FriendshipService
            .Setup(x => x.GetFriendIdsAsync(userId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { friendId });
        fixture.CategoryGrpcClient
            .Setup(x => x.GetCategoryInfoAsync(categoryId, userId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new CategoryInfo(categoryId, userId, "Work", "#111111", "briefcase"));
        fixture.GenericRepository
            .Setup(x => x.AddAsync(It.IsAny<TodoItem>(), It.IsAny<CancellationToken>()))
            .Callback<TodoItem, CancellationToken>((todo, _) => added = todo)
            .ReturnsAsync((TodoItem todo, CancellationToken _) => todo);

        var result = await fixture.CreateCreateHandler().Handle(
            new CreateTodoCommand(
                null,
                " Shared task ",
                " description ",
                categoryId,
                DateTime.UtcNow.AddDays(2),
                DateTime.UtcNow.AddDays(1),
                TodoPriority.High,
                SharedWithUserIds: new[] { friendId, friendId, Guid.Empty, userId }),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.NotNull(added);
        Assert.Equal(userId, added!.UserId);
        Assert.Equal("Shared task", added.Title);
        Assert.False(added.IsPublic);
        Assert.Single(added.SharedWith);
        Assert.Equal(friendId, added.SharedWith.Single().SharedWithUserId);
        Assert.Equal(categoryId, result.Value!.CategoryId);
        Assert.Equal("Work", result.Value.CategoryName);
        fixture.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task CreateTodo_ShouldCreatePublicTaskWithoutDirectShares()
    {
        var userId = Guid.NewGuid();
        var fixture = new TodoCommandFixture(userId);
        TodoItem? added = null;
        fixture.GenericRepository
            .Setup(x => x.AddAsync(It.IsAny<TodoItem>(), It.IsAny<CancellationToken>()))
            .Callback<TodoItem, CancellationToken>((todo, _) => added = todo)
            .ReturnsAsync((TodoItem todo, CancellationToken _) => todo);

        var result = await fixture.CreateCreateHandler().Handle(
            new CreateTodoCommand(
                null,
                "Public task",
                null,
                null,
                null,
                null,
                IsPublic: true,
                SharedWithUserIds: Array.Empty<Guid>()),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.NotNull(added);
        Assert.True(added!.IsPublic);
        Assert.Empty(added.SharedWith);
        Assert.True(result.Value!.IsPublic);
    }

    [Fact]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public async Task CreateTodo_ShouldRejectMissingUserAndForeignCategory()
    {
        var missingUser = new TodoCommandFixture(Guid.Empty);
        await Assert.ThrowsAsync<UnauthorizedAccessException>(() =>
            missingUser.CreateCreateHandler().Handle(
                new CreateTodoCommand(null, "Task", null, null, null, null),
                CancellationToken.None));

        var userId = Guid.NewGuid();
        var categoryId = Guid.NewGuid();
        var fixture = new TodoCommandFixture(userId);
        fixture.CategoryGrpcClient
            .Setup(x => x.GetCategoryInfoAsync(categoryId, userId, It.IsAny<CancellationToken>()))
            .ReturnsAsync((CategoryInfo?)null);

        await Assert.ThrowsAsync<ForbiddenException>(() =>
            fixture.CreateCreateHandler().Handle(
                new CreateTodoCommand(null, "Task", null, categoryId, null, null),
                CancellationToken.None));

        fixture.GenericRepository.Verify(x => x.AddAsync(It.IsAny<TodoItem>(), It.IsAny<CancellationToken>()), Times.Never);
        fixture.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task DeleteTodo_ShouldSoftDeleteOwnedTodoAndPersist()
    {
        var userId = Guid.NewGuid();
        var todo = TodoItem.Create(userId, "Owned task");
        var fixture = new TodoCommandFixture(userId);
        fixture.GenericRepository
            .Setup(x => x.GetByIdAsync(todo.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(todo);

        var result = await fixture.CreateDeleteHandler().Handle(
            new DeleteTodoCommand(todo.Id),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.True(todo.IsDeleted);
        Assert.Equal(userId, todo.DeletedBy);
        fixture.GenericRepository.Verify(x => x.Update(todo), Times.Once);
        fixture.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public async Task DeleteTodo_ShouldRejectMissingAndForeignTodoBeforePersisting()
    {
        var userId = Guid.NewGuid();
        var todoId = Guid.NewGuid();
        var fixture = new TodoCommandFixture(userId);
        fixture.GenericRepository
            .Setup(x => x.GetByIdAsync(todoId, It.IsAny<CancellationToken>()))
            .ReturnsAsync((TodoItem?)null);

        await Assert.ThrowsAsync<EntityNotFoundException>(() =>
            fixture.CreateDeleteHandler().Handle(new DeleteTodoCommand(todoId), CancellationToken.None));

        var foreign = TodoItem.Create(Guid.NewGuid(), "Foreign task");
        fixture.GenericRepository
            .Setup(x => x.GetByIdAsync(foreign.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(foreign);

        await Assert.ThrowsAsync<ForbiddenException>(() =>
            fixture.CreateDeleteHandler().Handle(new DeleteTodoCommand(foreign.Id), CancellationToken.None));

        Assert.False(foreign.IsDeleted);
        fixture.GenericRepository.Verify(x => x.Update(It.IsAny<TodoItem>()), Times.Never);
        fixture.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    public async Task UpdateTodo_ShouldAllowOwnerToEditAllMutableFieldsAndShareWithFriends()
    {
        var userId = Guid.NewGuid();
        var friendId = Guid.NewGuid();
        var categoryId = Guid.NewGuid();
        var todo = TodoItem.Create(userId, "Old title");
        var fixture = new TodoCommandFixture(userId);
        fixture.TodoRepository.Setup(x => x.GetByIdWithIncludesAsync(todo.Id, It.IsAny<CancellationToken>())).ReturnsAsync(todo);
        fixture.FriendshipService
            .Setup(x => x.GetFriendIdsAsync(userId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { friendId });
        fixture.CategoryGrpcClient
            .Setup(x => x.GetCategoryInfoAsync(categoryId, userId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new CategoryInfo(categoryId, userId, "Projects", "#222222", "folder"));

        var result = await fixture.CreateUpdateHandler().Handle(
            new UpdateTodoCommand(
                todo.Id,
                Title: "New title",
                Description: "New description",
                CategoryId: categoryId,
                DueDate: DateTime.UtcNow.AddDays(5),
                ExpectedDate: DateTime.UtcNow.AddDays(4),
                Priority: TodoPriority.Urgent,
                SharedWithUserIds: new[] { friendId, Guid.Empty, userId },
                Status: "done"),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal("New title", todo.Title);
        Assert.Equal("New description", todo.Description);
        Assert.Equal(categoryId, todo.CategoryId);
        Assert.Equal(TodoStatus.Done, todo.Status);
        Assert.False(todo.IsPublic);
        Assert.Single(todo.SharedWith);
        Assert.Equal("Projects", result.Value!.CategoryName);
        fixture.TodoRepository.Verify(x => x.Update(todo), Times.Once);
        fixture.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task UpdateTodo_ShouldTogglePublicIndependentlyFromDirectShares()
    {
        var userId = Guid.NewGuid();
        var friendId = Guid.NewGuid();
        var todo = TodoItem.Create(userId, "Task", sharedWithUserIds: new[] { friendId });
        var fixture = new TodoCommandFixture(userId);
        fixture.TodoRepository.Setup(x => x.GetByIdWithIncludesAsync(todo.Id, It.IsAny<CancellationToken>())).ReturnsAsync(todo);
        fixture.FriendshipService
            .Setup(x => x.GetFriendIdsAsync(userId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { friendId });

        var result = await fixture.CreateUpdateHandler().Handle(
            new UpdateTodoCommand(todo.Id, IsPublic: true, SharedWithUserIds: new[] { friendId }),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.True(todo.IsPublic);
        Assert.Single(todo.SharedWith);

        var privateAgain = await fixture.CreateUpdateHandler().Handle(
            new UpdateTodoCommand(todo.Id, IsPublic: false),
            CancellationToken.None);

        Assert.True(privateAgain.IsSuccess);
        Assert.False(todo.IsPublic);
        Assert.Single(todo.SharedWith);
    }

    [Fact]
    [Trait("TestType", "Security")]
    public async Task UpdateTodo_ShouldAllowSharedViewerStatusOnly_AndHideOwnerCategory()
    {
        var ownerId = Guid.NewGuid();
        var viewerId = Guid.NewGuid();
        var todo = TodoItem.Create(ownerId, "Shared", categoryId: Guid.NewGuid(), isPublic: true, sharedWithUserIds: new[] { viewerId });
        var fixture = new TodoCommandFixture(viewerId);
        fixture.TodoRepository.Setup(x => x.GetByIdWithIncludesAsync(todo.Id, It.IsAny<CancellationToken>())).ReturnsAsync(todo);
        fixture.FriendshipService.Setup(x => x.AreFriendsAsync(viewerId, ownerId, It.IsAny<CancellationToken>())).ReturnsAsync(true);

        var result = await fixture.CreateUpdateHandler().Handle(
            new UpdateTodoCommand(todo.Id, Status: "done"),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(TodoStatus.Done, todo.Status);
        Assert.Null(result.Value!.CategoryId);
        Assert.Null(result.Value.CategoryName);

        var publicOnlyTodo = TodoItem.Create(ownerId, "Public only", categoryId: Guid.NewGuid(), isPublic: true);
        fixture.TodoRepository.Setup(x => x.GetByIdWithIncludesAsync(publicOnlyTodo.Id, It.IsAny<CancellationToken>())).ReturnsAsync(publicOnlyTodo);

        var publicOnlyResult = await fixture.CreateUpdateHandler().Handle(
            new UpdateTodoCommand(publicOnlyTodo.Id, Status: "done"),
            CancellationToken.None);

        Assert.True(publicOnlyResult.IsSuccess);
        Assert.Equal(TodoStatus.Done, publicOnlyTodo.Status);
        Assert.Null(publicOnlyResult.Value!.CategoryId);

        await Assert.ThrowsAsync<ForbiddenException>(() =>
            fixture.CreateUpdateHandler().Handle(
                new UpdateTodoCommand(todo.Id, Title: "Viewer edit"),
                CancellationToken.None));
    }

    [Fact]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public async Task UpdateTodo_ShouldRejectForeignTodoAndSharingWithNonFriends()
    {
        var ownerId = Guid.NewGuid();
        var viewerId = Guid.NewGuid();
        var todo = TodoItem.Create(ownerId, "Private");
        var viewerFixture = new TodoCommandFixture(viewerId);
        viewerFixture.TodoRepository
            .Setup(x => x.GetByIdWithIncludesAsync(todo.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(todo);

        await Assert.ThrowsAsync<ForbiddenException>(() =>
            viewerFixture.CreateUpdateHandler().Handle(
                new UpdateTodoCommand(todo.Id, Status: "done"),
                CancellationToken.None));

        var friendId = Guid.NewGuid();
        var strangerId = Guid.NewGuid();
        var ownerFixture = new TodoCommandFixture(ownerId);
        ownerFixture.TodoRepository
            .Setup(x => x.GetByIdWithIncludesAsync(todo.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(todo);
        ownerFixture.FriendshipService
            .Setup(x => x.GetFriendIdsAsync(ownerId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { friendId });

        await Assert.ThrowsAsync<ForbiddenException>(() =>
            ownerFixture.CreateUpdateHandler().Handle(
                new UpdateTodoCommand(todo.Id, SharedWithUserIds: new[] { friendId, strangerId }),
                CancellationToken.None));

        ownerFixture.TodoRepository.Verify(x => x.Update(It.IsAny<TodoItem>()), Times.Never);
        ownerFixture.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task UpdateTodo_ShouldApplyActualDateAndStatusTransitions()
    {
        var userId = Guid.NewGuid();
        var todoWithActualDate = TodoItem.Create(userId, "Actual date task");
        var workflowTodo = TodoItem.Create(userId, "Workflow task");
        var actualDate = DateTime.UtcNow;
        var fixture = new TodoCommandFixture(userId);
        fixture.TodoRepository
            .Setup(x => x.GetByIdWithIncludesAsync(todoWithActualDate.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(todoWithActualDate);
        fixture.TodoRepository
            .Setup(x => x.GetByIdWithIncludesAsync(workflowTodo.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(workflowTodo);

        var withActualDate = await fixture.CreateUpdateHandler().Handle(
            new UpdateTodoCommand(todoWithActualDate.Id, ActualDate: actualDate),
            CancellationToken.None);

        Assert.True(withActualDate.IsSuccess);
        Assert.Equal(actualDate, todoWithActualDate.ActualDate);
        Assert.Equal(TodoStatus.Done, todoWithActualDate.Status);

        var inProgress = await fixture.CreateUpdateHandler().Handle(
            new UpdateTodoCommand(workflowTodo.Id, Status: "in progress"),
            CancellationToken.None);

        Assert.True(inProgress.IsSuccess);
        Assert.Equal(TodoStatus.InProgress, workflowTodo.Status);

        var backToTodo = await fixture.CreateUpdateHandler().Handle(
            new UpdateTodoCommand(workflowTodo.Id, Status: "todo"),
            CancellationToken.None);

        Assert.True(backToTodo.IsSuccess);
        Assert.Equal(TodoStatus.Todo, workflowTodo.Status);
        fixture.TodoRepository.Verify(x => x.Update(It.IsAny<TodoItem>()), Times.Exactly(3));
        fixture.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Exactly(3));
    }

    [Fact]
    [Trait("TestType", "Resilience")]
    public async Task UpdateTodo_ShouldStillSucceed_WhenPostSaveCategoryEnrichmentFails()
    {
        var userId = Guid.NewGuid();
        var categoryId = Guid.NewGuid();
        var todo = TodoItem.Create(userId, "Task", categoryId: categoryId);
        var fixture = new TodoCommandFixture(userId);
        fixture.TodoRepository.Setup(x => x.GetByIdWithIncludesAsync(todo.Id, It.IsAny<CancellationToken>())).ReturnsAsync(todo);
        fixture.CategoryGrpcClient
            .Setup(x => x.GetCategoryInfoAsync(categoryId, userId, It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("category api down"));

        var result = await fixture.CreateUpdateHandler().Handle(
            new UpdateTodoCommand(todo.Id, Description: "updated"),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal("updated", todo.Description);
        Assert.Equal(categoryId, result.Value!.CategoryId);
        Assert.Null(result.Value.CategoryName);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    public async Task SetTodoHidden_ShouldUseGlobalHiddenForPrivateTasks_AndViewerPreferenceForSharedTasks()
    {
        var userId = Guid.NewGuid();
        var categoryId = Guid.NewGuid();
        var privateTodo = TodoItem.Create(userId, "Private", categoryId: categoryId);
        var fixture = new TodoCommandFixture(userId);
        fixture.TodoRepository.Setup(x => x.GetByIdWithIncludesAsync(privateTodo.Id, It.IsAny<CancellationToken>())).ReturnsAsync(privateTodo);
        fixture.CategoryGrpcClient
            .Setup(x => x.GetCategoryInfoAsync(categoryId, userId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new CategoryInfo(categoryId, userId, "Personal", "#333333", "home"));

        var privateResult = await fixture.CreateSetHiddenHandler().Handle(
            new SetTodoHiddenCommand(privateTodo.Id, true),
            CancellationToken.None);

        Assert.True(privateResult.IsSuccess);
        Assert.True(privateTodo.Hidden);
        Assert.Equal("Personal", privateResult.Value!.CategoryName);
        fixture.TodoRepository.Verify(x => x.Update(privateTodo), Times.Once);

        var friendId = Guid.NewGuid();
        var sharedTodo = TodoItem.Create(userId, "Shared", isPublic: true, sharedWithUserIds: new[] { friendId });
        sharedTodo.SetHidden(true, userId);
        UserTodoViewPreference? upserted = null;
        fixture.TodoRepository.Setup(x => x.GetByIdWithIncludesAsync(sharedTodo.Id, It.IsAny<CancellationToken>())).ReturnsAsync(sharedTodo);
        fixture.ViewerPreferences
            .Setup(x => x.UpsertAsync(It.IsAny<UserTodoViewPreference>(), It.IsAny<CancellationToken>()))
            .Callback<UserTodoViewPreference, CancellationToken>((preference, _) => upserted = preference)
            .Returns(Task.CompletedTask);

        var sharedResult = await fixture.CreateSetHiddenHandler().Handle(
            new SetTodoHiddenCommand(sharedTodo.Id, false),
            CancellationToken.None);

        Assert.True(sharedResult.IsSuccess);
        Assert.NotNull(upserted);
        Assert.False(upserted!.HiddenByViewer);
        Assert.False(sharedTodo.Hidden);
        fixture.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Exactly(2));
    }

    [Fact]
    [Trait("TestType", "Resilience")]
    [Trait("TestType", "Regression")]
    public async Task SetTodoHidden_ShouldStillSucceed_WhenCategoryLookupFails()
    {
        var userId = Guid.NewGuid();
        var categoryId = Guid.NewGuid();
        var todo = TodoItem.Create(userId, "Categorized", categoryId: categoryId);
        var fixture = new TodoCommandFixture(userId);
        fixture.TodoRepository
            .Setup(x => x.GetByIdWithIncludesAsync(todo.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(todo);
        fixture.CategoryGrpcClient
            .Setup(x => x.GetCategoryInfoAsync(categoryId, userId, It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("category down"));

        var result = await fixture.CreateSetHiddenHandler().Handle(
            new SetTodoHiddenCommand(todo.Id, true),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.True(result.Value!.Hidden);
        Assert.Equal(categoryId, result.Value.CategoryId);
        Assert.Null(result.Value.CategoryName);
    }

    [Fact]
    [Trait("TestType", "Security")]
    public async Task SetTodoHidden_ShouldRejectForeignTodo()
    {
        var userId = Guid.NewGuid();
        var ownerId = Guid.NewGuid();
        var todo = TodoItem.Create(ownerId, "Foreign");
        var fixture = new TodoCommandFixture(userId);
        fixture.TodoRepository.Setup(x => x.GetByIdWithIncludesAsync(todo.Id, It.IsAny<CancellationToken>())).ReturnsAsync(todo);

        await Assert.ThrowsAsync<ForbiddenException>(() =>
            fixture.CreateSetHiddenHandler().Handle(new SetTodoHiddenCommand(todo.Id, true), CancellationToken.None));

        fixture.ViewerPreferences.Verify(x => x.UpsertAsync(It.IsAny<UserTodoViewPreference>(), It.IsAny<CancellationToken>()), Times.Never);
        fixture.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Acceptance")]
    public async Task SetViewerPreference_ShouldPersistSharedViewerHiddenAndCategoryPreferences()
    {
        var ownerId = Guid.NewGuid();
        var viewerId = Guid.NewGuid();
        var categoryId = Guid.NewGuid();
        var todo = TodoItem.Create(ownerId, "Public friend task", isPublic: true);
        var fixture = new TodoCommandFixture(viewerId);
        UserTodoViewPreference? upserted = null;
        fixture.TodoRepository.Setup(x => x.GetByIdWithIncludesAsync(todo.Id, It.IsAny<CancellationToken>())).ReturnsAsync(todo);
        fixture.FriendshipService.Setup(x => x.AreFriendsAsync(viewerId, ownerId, It.IsAny<CancellationToken>())).ReturnsAsync(true);
        fixture.CategoryGrpcClient
            .Setup(x => x.GetCategoryInfoAsync(categoryId, viewerId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new CategoryInfo(categoryId, viewerId, "Viewer list", "#444444", "eye"));
        fixture.ViewerPreferences
            .Setup(x => x.UpsertAsync(It.IsAny<UserTodoViewPreference>(), It.IsAny<CancellationToken>()))
            .Callback<UserTodoViewPreference, CancellationToken>((preference, _) => upserted = preference)
            .Returns(Task.CompletedTask);

        var result = await fixture.CreateSetViewerPreferenceHandler().Handle(
            new SetViewerPreferenceCommand(todo.Id, HiddenByViewer: true, ViewerCategoryId: categoryId, UpdateViewerCategory: true),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.True(result.Value!.HiddenByViewer);
        Assert.Equal(categoryId, result.Value.ViewerCategoryId);
        Assert.NotNull(upserted);
        Assert.Equal(viewerId, upserted!.ViewerId);
        Assert.Equal(categoryId, upserted.ViewerCategoryId);
        fixture.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    [Trait("TestType", "Security")]
    public async Task SetViewerPreference_ShouldRejectOwnerInvalidRequestNonFriendAndForeignViewerCategory()
    {
        var ownerId = Guid.NewGuid();
        var viewerId = Guid.NewGuid();
        var todo = TodoItem.Create(ownerId, "Shared", isPublic: true, sharedWithUserIds: new[] { viewerId });

        var ownerFixture = new TodoCommandFixture(ownerId);
        ownerFixture.TodoRepository.Setup(x => x.GetByIdWithIncludesAsync(todo.Id, It.IsAny<CancellationToken>())).ReturnsAsync(todo);
        var ownerResult = await ownerFixture.CreateSetViewerPreferenceHandler().Handle(
            new SetViewerPreferenceCommand(todo.Id, HiddenByViewer: true),
            CancellationToken.None);
        Assert.Equal("OWNER_MUST_USE_HIDDEN_ENDPOINT", ownerResult.Error!.Code);

        var viewerFixture = new TodoCommandFixture(viewerId);
        viewerFixture.TodoRepository.Setup(x => x.GetByIdWithIncludesAsync(todo.Id, It.IsAny<CancellationToken>())).ReturnsAsync(todo);
        viewerFixture.FriendshipService.Setup(x => x.AreFriendsAsync(viewerId, ownerId, It.IsAny<CancellationToken>())).ReturnsAsync(true);
        var invalidRequest = await viewerFixture.CreateSetViewerPreferenceHandler().Handle(
            new SetViewerPreferenceCommand(todo.Id),
            CancellationToken.None);
        Assert.Equal("INVALID_VIEWER_PREFERENCE_REQUEST", invalidRequest.Error!.Code);

        viewerFixture.FriendshipService.Setup(x => x.AreFriendsAsync(viewerId, ownerId, It.IsAny<CancellationToken>())).ReturnsAsync(false);
        await Assert.ThrowsAsync<ForbiddenException>(() =>
            viewerFixture.CreateSetViewerPreferenceHandler().Handle(
                new SetViewerPreferenceCommand(todo.Id, HiddenByViewer: true),
                CancellationToken.None));

        viewerFixture.FriendshipService.Setup(x => x.AreFriendsAsync(viewerId, ownerId, It.IsAny<CancellationToken>())).ReturnsAsync(true);
        var foreignCategoryId = Guid.NewGuid();
        viewerFixture.CategoryGrpcClient
            .Setup(x => x.GetCategoryInfoAsync(foreignCategoryId, viewerId, It.IsAny<CancellationToken>()))
            .ReturnsAsync((CategoryInfo?)null);
        await Assert.ThrowsAsync<ForbiddenException>(() =>
            viewerFixture.CreateSetViewerPreferenceHandler().Handle(
                new SetViewerPreferenceCommand(todo.Id, ViewerCategoryId: foreignCategoryId, UpdateViewerCategory: true),
                CancellationToken.None));
    }

    private sealed class TodoCommandFixture
    {
        public Mock<IRepository<TodoItem>> GenericRepository { get; } = new();
        public Mock<ITodoRepository> TodoRepository { get; } = new();
        public Mock<IUnitOfWork> UnitOfWork { get; } = new();
        public Mock<IMapper> Mapper { get; } = new();
        public Mock<ICurrentUserContext> CurrentUser { get; } = new();
        public Mock<ICategoryGrpcClient> CategoryGrpcClient { get; } = new();
        public Mock<IFriendshipService> FriendshipService { get; } = new();
        public Mock<IUserTodoViewPreferenceRepository> ViewerPreferences { get; } = new();

        public TodoCommandFixture(Guid userId)
        {
            CurrentUser.SetupGet(x => x.UserId).Returns(userId);
            CurrentUser.SetupGet(x => x.IsAuthenticated).Returns(userId != Guid.Empty);
            UnitOfWork.Setup(x => x.SaveChangesAsync(It.IsAny<CancellationToken>())).ReturnsAsync(1);
            Mapper.Setup(x => x.Map<TodoItemDto>(It.IsAny<TodoItem>())).Returns((TodoItem item) => ToDto(item));
        }

        public CreateTodoCommandHandler CreateCreateHandler()
            => new(
                GenericRepository.Object,
                UnitOfWork.Object,
                Mapper.Object,
                Mock.Of<ILogger<CreateTodoCommandHandler>>(),
                CurrentUser.Object,
                CategoryGrpcClient.Object,
                FriendshipService.Object);

        public UpdateTodoCommandHandler CreateUpdateHandler()
            => new(
                TodoRepository.Object,
                UnitOfWork.Object,
                Mapper.Object,
                Mock.Of<ILogger<UpdateTodoCommandHandler>>(),
                CurrentUser.Object,
                CategoryGrpcClient.Object,
                FriendshipService.Object);

        public SetTodoHiddenCommandHandler CreateSetHiddenHandler()
            => new(
                TodoRepository.Object,
                UnitOfWork.Object,
                CurrentUser.Object,
                Mock.Of<ILogger<SetTodoHiddenCommandHandler>>(),
                CategoryGrpcClient.Object,
                ViewerPreferences.Object);

        public SetViewerPreferenceCommandHandler CreateSetViewerPreferenceHandler()
            => new(
                TodoRepository.Object,
                UnitOfWork.Object,
                CurrentUser.Object,
                ViewerPreferences.Object,
                FriendshipService.Object,
                CategoryGrpcClient.Object,
                Mock.Of<ILogger<SetViewerPreferenceCommandHandler>>());

        public DeleteTodoCommandHandler CreateDeleteHandler()
            => new(
                GenericRepository.Object,
                UnitOfWork.Object,
                Mock.Of<ILogger<DeleteTodoCommandHandler>>(),
                CurrentUser.Object);
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
