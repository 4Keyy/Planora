using AutoMapper;
using Planora.BuildingBlocks.Domain.Exceptions;
using Planora.BuildingBlocks.Domain.Interfaces;
using Planora.BuildingBlocks.Application.Context;
using Planora.Todo.Application.DTOs;
using Planora.Todo.Application.Features.Todos.Commands.CreateTodo;
using Planora.Todo.Application.Features.Todos.Commands.DeleteTodo;
using Planora.Todo.Application.Features.Todos.Commands.DuplicateTodo;
using Planora.Todo.Application.Features.Todos.Commands.SetTodoHidden;
using Planora.Todo.Application.Features.Todos.Commands.SetViewerPreference;
using Planora.Todo.Application.Features.Todos.Commands.UpdateTodo;
using Planora.Todo.Application.Features.Todos.Commands.CreateSubtask;
using Planora.Todo.Application.Features.Todos.Queries.GetSubtasks;
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
        fixture.TodoRepository
            .Setup(x => x.GetByIdAsync(todo.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(todo);

        var result = await fixture.CreateDeleteHandler().Handle(
            new DeleteTodoCommand(todo.Id),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.True(todo.IsDeleted);
        Assert.Equal(userId, todo.DeletedBy);
        fixture.TodoRepository.Verify(x => x.Update(todo), Times.Once);
        fixture.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    public async Task DeleteTodo_OnSubtask_EnqueuesSubtaskDeletedForParentBranch()
    {
        // Deleting a subtask must remove only its announcement comments from the PARENT's branch
        // (SubtaskDeletedIntegrationEvent), never wipe a whole branch (TaskDeletedIntegrationEvent).
        var userId = Guid.NewGuid();
        var parent = TodoItem.Create(userId, "Parent");
        var subtask = TodoItem.CreateSubtask(parent, userId, "Draft outline", null);
        var fixture = new TodoCommandFixture(userId);

        Planora.BuildingBlocks.Application.Outbox.OutboxMessage? captured = null;
        fixture.OutboxRepository
            .Setup(x => x.AddAsync(It.IsAny<Planora.BuildingBlocks.Application.Outbox.OutboxMessage>(), It.IsAny<CancellationToken>()))
            .Callback<Planora.BuildingBlocks.Application.Outbox.OutboxMessage, CancellationToken>((m, _) => captured = m);
        fixture.TodoRepository
            .Setup(x => x.GetByIdAsync(subtask.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(subtask);

        var result = await fixture.CreateDeleteHandler().Handle(
            new DeleteTodoCommand(subtask.Id), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.True(subtask.IsDeleted);
        Assert.NotNull(captured);
        Assert.Contains(nameof(Planora.BuildingBlocks.Application.Messaging.Events.SubtaskDeletedIntegrationEvent), captured!.Type);
        Assert.Contains("Draft outline", captured.Content);            // title for suffix matching
        Assert.Contains(parent.Id.ToString(), captured.Content);       // targets the parent branch
    }

    [Fact]
    [Trait("TestType", "Functional")]
    public async Task DuplicateTodo_ByOwner_CopiesContentNotDatesOrBranch_AndEmitsCreated()
    {
        var userId = Guid.NewGuid();
        var categoryId = Guid.NewGuid();
        var fixture = new TodoCommandFixture(userId);

        var source = TodoItem.Create(
            userId, "Quarterly report", "Collect the numbers", categoryId,
            dueDate: DateTime.UtcNow.AddDays(3), expectedDate: DateTime.UtcNow.AddDays(2),
            priority: TodoPriority.High, isPublic: false, sharedWithUserIds: null, requiredWorkers: 3);
        source.AddTag("urgent", userId);

        fixture.TodoRepository
            .Setup(x => x.GetByIdWithIncludesAsync(source.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(source);
        fixture.CategoryGrpcClient
            .Setup(x => x.GetCategoryInfoAsync(categoryId, userId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new CategoryInfo(categoryId, userId, "Work", "#111111", "briefcase"));

        TodoItem? copy = null;
        Planora.BuildingBlocks.Application.Outbox.OutboxMessage? captured = null;
        fixture.TodoRepository
            .Setup(x => x.AddAsync(It.IsAny<TodoItem>(), It.IsAny<CancellationToken>()))
            .Callback<TodoItem, CancellationToken>((t, _) => copy = t)
            .ReturnsAsync((TodoItem t, CancellationToken _) => t);
        fixture.OutboxRepository
            .Setup(x => x.AddAsync(It.IsAny<Planora.BuildingBlocks.Application.Outbox.OutboxMessage>(), It.IsAny<CancellationToken>()))
            .Callback<Planora.BuildingBlocks.Application.Outbox.OutboxMessage, CancellationToken>((m, _) => captured = m);

        var result = await fixture.CreateDuplicateHandler().Handle(
            new DuplicateTodoCommand(source.Id), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.NotNull(copy);
        // Content copied …
        Assert.Equal("Quarterly report", copy!.Title);
        Assert.Equal("Collect the numbers", copy.Description);
        Assert.Equal(TodoPriority.High, copy.Priority);
        Assert.Equal(categoryId, copy.CategoryId);
        Assert.Equal(3, copy.RequiredWorkers);
        Assert.Contains(copy.Tags, t => t.Name == "urgent");
        // … dates, completion and identity NOT copied …
        Assert.Null(copy.DueDate);
        Assert.Null(copy.ExpectedDate);
        Assert.False(copy.IsCompleted);
        Assert.NotEqual(source.Id, copy.Id);
        // … and the new branch's creation fact is published.
        Assert.NotNull(captured);
        Assert.Contains(nameof(Planora.BuildingBlocks.Application.Messaging.Events.TaskCreatedIntegrationEvent), captured!.Type);
    }

    [Fact]
    [Trait("TestType", "Security")]
    public async Task DuplicateTodo_ByNonOwner_ThrowsForbidden()
    {
        var userId = Guid.NewGuid();
        var fixture = new TodoCommandFixture(userId);
        var foreign = TodoItem.Create(Guid.NewGuid(), "Someone else's task");
        fixture.TodoRepository
            .Setup(x => x.GetByIdWithIncludesAsync(foreign.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(foreign);

        await Assert.ThrowsAsync<ForbiddenException>(() =>
            fixture.CreateDuplicateHandler().Handle(new DuplicateTodoCommand(foreign.Id), CancellationToken.None));

        fixture.TodoRepository.Verify(x => x.AddAsync(It.IsAny<TodoItem>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    [Trait("TestType", "Security")]
    public async Task DuplicateTodo_OnSubtaskOrMissing_ThrowsNotFound()
    {
        var userId = Guid.NewGuid();
        var fixture = new TodoCommandFixture(userId);

        var missingId = Guid.NewGuid();
        fixture.TodoRepository
            .Setup(x => x.GetByIdWithIncludesAsync(missingId, It.IsAny<CancellationToken>()))
            .ReturnsAsync((TodoItem?)null);
        await Assert.ThrowsAsync<EntityNotFoundException>(() =>
            fixture.CreateDuplicateHandler().Handle(new DuplicateTodoCommand(missingId), CancellationToken.None));

        var parent = TodoItem.Create(userId, "Parent");
        var subtask = TodoItem.CreateSubtask(parent, userId, "A step", null);
        fixture.TodoRepository
            .Setup(x => x.GetByIdWithIncludesAsync(subtask.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(subtask);
        await Assert.ThrowsAsync<EntityNotFoundException>(() =>
            fixture.CreateDuplicateHandler().Handle(new DuplicateTodoCommand(subtask.Id), CancellationToken.None));
    }

    [Fact]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public async Task DeleteTodo_ShouldRejectMissingAndForeignTodoBeforePersisting()
    {
        var userId = Guid.NewGuid();
        var todoId = Guid.NewGuid();
        var fixture = new TodoCommandFixture(userId);
        fixture.TodoRepository
            .Setup(x => x.GetByIdAsync(todoId, It.IsAny<CancellationToken>()))
            .ReturnsAsync((TodoItem?)null);

        await Assert.ThrowsAsync<EntityNotFoundException>(() =>
            fixture.CreateDeleteHandler().Handle(new DeleteTodoCommand(todoId), CancellationToken.None));

        var foreign = TodoItem.Create(Guid.NewGuid(), "Foreign task");
        fixture.TodoRepository
            .Setup(x => x.GetByIdAsync(foreign.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(foreign);

        await Assert.ThrowsAsync<ForbiddenException>(() =>
            fixture.CreateDeleteHandler().Handle(new DeleteTodoCommand(foreign.Id), CancellationToken.None));

        Assert.False(foreign.IsDeleted);
        fixture.TodoRepository.Verify(x => x.Update(It.IsAny<TodoItem>()), Times.Never);
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
        fixture.TodoRepository.Setup(x => x.GetByIdWithIncludesTrackedAsync(todo.Id, It.IsAny<CancellationToken>())).ReturnsAsync(todo);
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
        fixture.TodoRepository.Setup(x => x.GetByIdWithIncludesTrackedAsync(todo.Id, It.IsAny<CancellationToken>())).ReturnsAsync(todo);
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
        fixture.TodoRepository.Setup(x => x.GetByIdWithIncludesTrackedAsync(todo.Id, It.IsAny<CancellationToken>())).ReturnsAsync(todo);
        fixture.FriendshipService.Setup(x => x.AreFriendsAsync(viewerId, ownerId, It.IsAny<CancellationToken>())).ReturnsAsync(true);

        var result = await fixture.CreateUpdateHandler().Handle(
            new UpdateTodoCommand(todo.Id, Status: "done"),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        // Viewer completion is recorded per-viewer; the shared entity status is unchanged
        Assert.Equal("Done", result.Value!.Status);
        Assert.Equal(TodoStatus.Todo, todo.Status);
        Assert.Null(result.Value!.CategoryId);
        Assert.Null(result.Value.CategoryName);

        var publicOnlyTodo = TodoItem.Create(ownerId, "Public only", categoryId: Guid.NewGuid(), isPublic: true);
        fixture.TodoRepository.Setup(x => x.GetByIdWithIncludesTrackedAsync(publicOnlyTodo.Id, It.IsAny<CancellationToken>())).ReturnsAsync(publicOnlyTodo);

        var publicOnlyResult = await fixture.CreateUpdateHandler().Handle(
            new UpdateTodoCommand(publicOnlyTodo.Id, Status: "done"),
            CancellationToken.None);

        Assert.True(publicOnlyResult.IsSuccess);
        Assert.Equal("Done", publicOnlyResult.Value!.Status);
        Assert.Equal(TodoStatus.Todo, publicOnlyTodo.Status);
        Assert.Null(publicOnlyResult.Value!.CategoryId);

        await Assert.ThrowsAsync<ForbiddenException>(() =>
            fixture.CreateUpdateHandler().Handle(
                new UpdateTodoCommand(todo.Id, Title: "Viewer edit"),
                CancellationToken.None));
    }

    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task UpdateTodo_Viewer_ShouldRemoveWorkerStatusOnCompletion()
    {
        var ownerId = Guid.NewGuid();
        var viewerId = Guid.NewGuid();
        var todo = TodoItem.Create(ownerId, "Shared task", isPublic: true, sharedWithUserIds: new[] { viewerId });
        todo.AddWorker(viewerId);

        var fixture = new TodoCommandFixture(viewerId);
        fixture.TodoRepository.Setup(x => x.GetByIdWithIncludesTrackedAsync(todo.Id, It.IsAny<CancellationToken>())).ReturnsAsync(todo);
        fixture.FriendshipService.Setup(x => x.AreFriendsAsync(viewerId, ownerId, It.IsAny<CancellationToken>())).ReturnsAsync(true);

        Assert.Single(todo.Workers);

        var result = await fixture.CreateUpdateHandler().Handle(
            new UpdateTodoCommand(todo.Id, Status: "done"),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal("Done", result.Value!.Status);
        Assert.Empty(todo.Workers);
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
            .Setup(x => x.GetByIdWithIncludesTrackedAsync(todo.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(todo);

        await Assert.ThrowsAsync<ForbiddenException>(() =>
            viewerFixture.CreateUpdateHandler().Handle(
                new UpdateTodoCommand(todo.Id, Status: "done"),
                CancellationToken.None));

        var friendId = Guid.NewGuid();
        var strangerId = Guid.NewGuid();
        var ownerFixture = new TodoCommandFixture(ownerId);
        ownerFixture.TodoRepository
            .Setup(x => x.GetByIdWithIncludesTrackedAsync(todo.Id, It.IsAny<CancellationToken>()))
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
            .Setup(x => x.GetByIdWithIncludesTrackedAsync(todoWithActualDate.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(todoWithActualDate);
        fixture.TodoRepository
            .Setup(x => x.GetByIdWithIncludesTrackedAsync(workflowTodo.Id, It.IsAny<CancellationToken>()))
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
        fixture.TodoRepository.Setup(x => x.GetByIdWithIncludesTrackedAsync(todo.Id, It.IsAny<CancellationToken>())).ReturnsAsync(todo);
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
        fixture.TodoRepository.Setup(x => x.GetByIdWithIncludesTrackedAsync(privateTodo.Id, It.IsAny<CancellationToken>())).ReturnsAsync(privateTodo);
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
        fixture.TodoRepository.Setup(x => x.GetByIdWithIncludesTrackedAsync(sharedTodo.Id, It.IsAny<CancellationToken>())).ReturnsAsync(sharedTodo);
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
            .Setup(x => x.GetByIdWithIncludesTrackedAsync(todo.Id, It.IsAny<CancellationToken>()))
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
        fixture.TodoRepository.Setup(x => x.GetByIdWithIncludesTrackedAsync(todo.Id, It.IsAny<CancellationToken>())).ReturnsAsync(todo);

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

    [Fact]
    [Trait("TestType", "Regression")]
    [Trait("TestType", "Functional")]
    public async Task UpdateTodo_ShouldPersistVisibility_WhenPrivateTaskMadePublicForAllFriends()
    {
        // Regression: private task → IsPublic=true must be reflected in the returned DTO.
        // The handler must load the entity via GetByIdWithIncludesTrackedAsync so that EF Core
        // change-tracking generates the correct UPDATE SQL (AsNoTracking + DbSet.Update() on a
        // detached entity graph can skip collection-change DML under certain conditions).
        var userId = Guid.NewGuid();
        var todo = TodoItem.Create(userId, "Private task");
        Assert.False(todo.IsPublic);
        Assert.Empty(todo.SharedWith);

        var fixture = new TodoCommandFixture(userId);
        fixture.TodoRepository
            .Setup(x => x.GetByIdWithIncludesTrackedAsync(todo.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(todo);

        var result = await fixture.CreateUpdateHandler().Handle(
            new UpdateTodoCommand(todo.Id, IsPublic: true, SharedWithUserIds: Array.Empty<Guid>()),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.True(todo.IsPublic, "IsPublic must be true after update");
        Assert.True(result.Value!.IsPublic, "DTO must reflect IsPublic=true");
        Assert.Empty(todo.SharedWith);
        fixture.TodoRepository.Verify(x => x.Update(todo), Times.Once);
        fixture.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    [Trait("TestType", "Regression")]
    [Trait("TestType", "Functional")]
    public async Task UpdateTodo_ShouldPersistVisibility_WhenPrivateTaskSharedWithSpecificFriends()
    {
        // Regression: private task → sharedWithUserIds=[friendId] must result in a new
        // TodoItemShare being added to the entity's collection.  With a tracked entity EF Core
        // will INSERT the new share row; with a detached (AsNoTracking) entity it would silently
        // generate an UPDATE against a non-existent row and discard the share.
        var userId = Guid.NewGuid();
        var friendId = Guid.NewGuid();
        var todo = TodoItem.Create(userId, "Private task");
        Assert.False(todo.IsPublic);
        Assert.Empty(todo.SharedWith);

        var fixture = new TodoCommandFixture(userId);
        fixture.TodoRepository
            .Setup(x => x.GetByIdWithIncludesTrackedAsync(todo.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(todo);
        fixture.FriendshipService
            .Setup(x => x.GetFriendIdsAsync(userId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { friendId });

        var result = await fixture.CreateUpdateHandler().Handle(
            new UpdateTodoCommand(todo.Id, IsPublic: false, SharedWithUserIds: new[] { friendId }),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.False(todo.IsPublic);
        Assert.Single(todo.SharedWith);
        Assert.Equal(friendId, todo.SharedWith.Single().SharedWithUserId);
        Assert.Single(result.Value!.SharedWithUserIds);
        fixture.TodoRepository.Verify(x => x.Update(todo), Times.Once);
        fixture.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    // ── Subtasks ──────────────────────────────────────────────────────────────

    [Fact]
    [Trait("TestType", "Functional")]
    public async Task CreateSubtask_InheritsParentCategoryVisibilityShares_WithOwnPriorityAndNoDates()
    {
        var userId = Guid.NewGuid();
        var friendId = Guid.NewGuid();
        var categoryId = Guid.NewGuid();
        var parent = TodoItem.Create(
            userId, "Parent", "desc", categoryId,
            DateTime.UtcNow.AddDays(3), null, TodoPriority.Low,
            isPublic: true, sharedWithUserIds: new[] { friendId });
        var fixture = new TodoCommandFixture(userId);
        fixture.TodoRepository
            .Setup(x => x.GetByIdWithIncludesTrackedAsync(parent.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(parent);
        TodoItem? added = null;
        fixture.TodoRepository
            .Setup(x => x.AddAsync(It.IsAny<TodoItem>(), It.IsAny<CancellationToken>()))
            .Callback<TodoItem, CancellationToken>((t, _) => added = t)
            .ReturnsAsync((TodoItem t, CancellationToken _) => t);
        fixture.CategoryGrpcClient
            .Setup(x => x.GetCategoryInfoAsync(categoryId, userId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new CategoryInfo(categoryId, userId, "Work", "#fff", "icon"));

        var result = await fixture.CreateSubtaskHandler().Handle(
            new CreateSubtaskCommand(parent.Id, "  Step 1  ", "note", TodoPriority.Urgent),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.NotNull(added);
        Assert.Equal(parent.Id, added!.ParentTodoId);
        Assert.True(added.IsSubtask);
        Assert.Equal("Step 1", added.Title);
        Assert.Equal(categoryId, added.CategoryId);          // inherited
        Assert.True(added.IsPublic);                          // inherited
        Assert.Contains(added.SharedWith, s => s.SharedWithUserId == friendId); // inherited
        Assert.Equal(TodoPriority.Urgent, added.Priority);    // own
        Assert.Null(added.DueDate);                           // never
        Assert.Null(added.ExpectedDate);                      // never
        Assert.Equal("Work", result.Value!.CategoryName);
        fixture.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
        // Subtask creation is silent — no system message is enqueued for the parent's branch.
        fixture.OutboxRepository.Verify(
            x => x.AddAsync(It.IsAny<Planora.BuildingBlocks.Application.Outbox.OutboxMessage>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    [Trait("TestType", "Security")]
    public async Task CreateSubtask_RejectsForeignParent()
    {
        var userId = Guid.NewGuid();
        var parent = TodoItem.Create(Guid.NewGuid(), "Foreign");
        var fixture = new TodoCommandFixture(userId);
        fixture.TodoRepository
            .Setup(x => x.GetByIdWithIncludesTrackedAsync(parent.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(parent);

        await Assert.ThrowsAsync<ForbiddenException>(() =>
            fixture.CreateSubtaskHandler().Handle(new CreateSubtaskCommand(parent.Id, "x"), CancellationToken.None));
        fixture.TodoRepository.Verify(x => x.AddAsync(It.IsAny<TodoItem>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    public async Task CreateSubtask_RejectsNestingUnderSubtask()
    {
        var userId = Guid.NewGuid();
        var parent = TodoItem.Create(userId, "Parent");
        var subtask = TodoItem.CreateSubtask(parent, userId, "child", null);
        var fixture = new TodoCommandFixture(userId);
        fixture.TodoRepository
            .Setup(x => x.GetByIdWithIncludesTrackedAsync(subtask.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(subtask);

        await Assert.ThrowsAsync<ForbiddenException>(() =>
            fixture.CreateSubtaskHandler().Handle(new CreateSubtaskCommand(subtask.Id, "grandchild"), CancellationToken.None));
    }

    [Fact]
    [Trait("TestType", "Functional")]
    public async Task UpdateTodo_OnSubtask_RejectsInheritedFieldChanges_ButAllowsPriority()
    {
        var userId = Guid.NewGuid();
        var parent = TodoItem.Create(userId, "Parent", categoryId: Guid.NewGuid());
        var subtask = TodoItem.CreateSubtask(parent, userId, "child", null, TodoPriority.Low);
        var fixture = new TodoCommandFixture(userId);
        fixture.TodoRepository
            .Setup(x => x.GetByIdWithIncludesTrackedAsync(subtask.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(subtask);

        await Assert.ThrowsAsync<ForbiddenException>(() =>
            fixture.CreateUpdateHandler().Handle(
                new UpdateTodoCommand(subtask.Id, CategoryId: Guid.NewGuid()), CancellationToken.None));

        var ok = await fixture.CreateUpdateHandler().Handle(
            new UpdateTodoCommand(subtask.Id, Priority: TodoPriority.Urgent), CancellationToken.None);
        Assert.True(ok.IsSuccess);
        Assert.Equal(TodoPriority.Urgent, subtask.Priority);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    public async Task UpdateTodo_OnParent_PropagatesVisibilityToSubtasks()
    {
        var userId = Guid.NewGuid();
        var parent = TodoItem.Create(userId, "Parent", isPublic: true);
        var child1 = TodoItem.CreateSubtask(parent, userId, "c1", null);
        var child2 = TodoItem.CreateSubtask(parent, userId, "c2", null);
        Assert.True(child1.IsPublic);
        var fixture = new TodoCommandFixture(userId);
        fixture.TodoRepository
            .Setup(x => x.GetByIdWithIncludesTrackedAsync(parent.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(parent);
        fixture.TodoRepository
            .Setup(x => x.GetSubtasksTrackedAsync(parent.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { child1, child2 });

        var result = await fixture.CreateUpdateHandler().Handle(
            new UpdateTodoCommand(parent.Id, IsPublic: false), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.False(parent.IsPublic);
        Assert.False(child1.IsPublic);
        Assert.False(child2.IsPublic);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    public async Task DeleteTodo_SoftDeletesSubtasksWithParent()
    {
        var userId = Guid.NewGuid();
        var parent = TodoItem.Create(userId, "Parent");
        var child = TodoItem.CreateSubtask(parent, userId, "c1", null);
        var fixture = new TodoCommandFixture(userId);
        fixture.TodoRepository
            .Setup(x => x.GetByIdAsync(parent.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(parent);
        fixture.TodoRepository
            .Setup(x => x.GetSubtasksTrackedAsync(parent.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { child });

        var result = await fixture.CreateDeleteHandler().Handle(new DeleteTodoCommand(parent.Id), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.True(parent.IsDeleted);
        Assert.True(child.IsDeleted);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    public async Task UpdateTodo_NonOwnerCompletesSubtask_GloballyNotPerViewer()
    {
        var ownerId = Guid.NewGuid();
        var friendId = Guid.NewGuid();
        // Public parent so the friend has access; subtask inherits public.
        var parent = TodoItem.Create(ownerId, "Parent", isPublic: true);
        var subtask = TodoItem.CreateSubtask(parent, ownerId, "Shared step", null);
        var fixture = new TodoCommandFixture(friendId);
        fixture.TodoRepository
            .Setup(x => x.GetByIdWithIncludesTrackedAsync(subtask.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(subtask);
        fixture.FriendshipService
            .Setup(x => x.AreFriendsAsync(friendId, ownerId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);

        var result = await fixture.CreateUpdateHandler().Handle(
            new UpdateTodoCommand(subtask.Id, Status: "done"), CancellationToken.None);

        Assert.True(result.IsSuccess);
        // Global completion: the entity status itself flips to Done (not a per-viewer row).
        Assert.True(subtask.IsCompleted);
        fixture.TodoRepository.Verify(x => x.Update(subtask), Times.Once);
        fixture.ViewerPreferences.Verify(
            x => x.UpsertAsync(It.IsAny<UserTodoViewPreference>(), It.IsAny<CancellationToken>()), Times.Never);
        // A "X completed a subtask" system message is enqueued for the parent's branch.
        fixture.OutboxRepository.Verify(
            x => x.AddAsync(It.IsAny<Planora.BuildingBlocks.Application.Outbox.OutboxMessage>(), It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    [Trait("TestType", "Security")]
    public async Task UpdateTodo_NonOwnerCannotEditSubtaskTitleOrPriority()
    {
        var ownerId = Guid.NewGuid();
        var friendId = Guid.NewGuid();
        var parent = TodoItem.Create(ownerId, "Parent", isPublic: true);
        var subtask = TodoItem.CreateSubtask(parent, ownerId, "Shared step", null);
        var fixture = new TodoCommandFixture(friendId);
        fixture.TodoRepository
            .Setup(x => x.GetByIdWithIncludesTrackedAsync(subtask.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(subtask);
        fixture.FriendshipService
            .Setup(x => x.AreFriendsAsync(friendId, ownerId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);

        await Assert.ThrowsAsync<ForbiddenException>(() =>
            fixture.CreateUpdateHandler().Handle(
                new UpdateTodoCommand(subtask.Id, Priority: TodoPriority.Urgent), CancellationToken.None));
    }

    [Fact]
    [Trait("TestType", "Security")]
    public async Task GetSubtasks_RejectsViewerWithoutAccessToPrivateParent()
    {
        var ownerId = Guid.NewGuid();
        var viewerId = Guid.NewGuid();
        var parent = TodoItem.Create(ownerId, "Private parent"); // not public, not shared
        var fixture = new TodoCommandFixture(viewerId);
        fixture.TodoRepository
            .Setup(x => x.GetByIdWithIncludesAsync(parent.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(parent);

        await Assert.ThrowsAsync<ForbiddenException>(() =>
            fixture.CreateGetSubtasksHandler().Handle(new GetSubtasksQuery(parent.Id), CancellationToken.None));
    }

    [Fact]
    [Trait("TestType", "Functional")]
    public async Task GetSubtasks_ReturnsChildrenForOwner()
    {
        var userId = Guid.NewGuid();
        var parent = TodoItem.Create(userId, "Parent");
        var child = TodoItem.CreateSubtask(parent, userId, "c1", null);
        var fixture = new TodoCommandFixture(userId);
        fixture.TodoRepository
            .Setup(x => x.GetByIdWithIncludesAsync(parent.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(parent);
        fixture.TodoRepository
            .Setup(x => x.GetSubtasksAsync(parent.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { child });

        var result = await fixture.CreateGetSubtasksHandler().Handle(new GetSubtasksQuery(parent.Id), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Single(result.Value!);
        Assert.Equal(child.Id, result.Value![0].Id);
        Assert.Equal(parent.Id, result.Value![0].ParentTodoId);
    }

    private sealed class TodoCommandFixture
    {
        public Mock<IRepository<TodoItem>> GenericRepository { get; } = new();
        public Mock<ITodoRepository> TodoRepository { get; } = new();
        public Mock<Planora.BuildingBlocks.Application.Outbox.IOutboxRepository> OutboxRepository { get; } = new();
        public Mock<IUnitOfWork> UnitOfWork { get; } = new();
        public Mock<IMapper> Mapper { get; } = new();
        public Mock<ICurrentUserContext> CurrentUser { get; } = new();
        public Mock<ICategoryGrpcClient> CategoryGrpcClient { get; } = new();
        public Mock<IFriendshipService> FriendshipService { get; } = new();
        public Mock<IUserProfileService> UserProfiles { get; } = new();
        public Mock<IUserTodoViewPreferenceRepository> ViewerPreferences { get; } = new();

        public TodoCommandFixture(Guid userId)
        {
            CurrentUser.SetupGet(x => x.UserId).Returns(userId);
            CurrentUser.SetupGet(x => x.IsAuthenticated).Returns(userId != Guid.Empty);
            UnitOfWork.Setup(x => x.SaveChangesAsync(It.IsAny<CancellationToken>())).ReturnsAsync(1);
            Mapper.Setup(x => x.Map<TodoItemDto>(It.IsAny<TodoItem>())).Returns((TodoItem item) => ToDto(item));
            // Subtask lookups default to empty so parent update/delete propagation is a no-op
            // unless a test opts in by stubbing these explicitly.
            TodoRepository
                .Setup(x => x.GetSubtasksTrackedAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync(Array.Empty<TodoItem>());
            TodoRepository
                .Setup(x => x.GetSubtasksAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync(Array.Empty<TodoItem>());
            // Author enrichment is failure-tolerant — default to "no profiles resolved".
            UserProfiles
                .Setup(x => x.GetProfilesAsync(It.IsAny<IEnumerable<Guid>>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync(new Dictionary<Guid, UserProfileInfo>());
        }

        public CreateTodoCommandHandler CreateCreateHandler()
            => new(
                GenericRepository.Object,
                UnitOfWork.Object,
                Mapper.Object,
                Mock.Of<ILogger<CreateTodoCommandHandler>>(),
                CurrentUser.Object,
                CategoryGrpcClient.Object,
                FriendshipService.Object,
                Mock.Of<Planora.BuildingBlocks.Application.Outbox.IOutboxRepository>());

        public UpdateTodoCommandHandler CreateUpdateHandler()
            => new(
                TodoRepository.Object,
                UnitOfWork.Object,
                Mapper.Object,
                Mock.Of<ILogger<UpdateTodoCommandHandler>>(),
                CurrentUser.Object,
                CategoryGrpcClient.Object,
                FriendshipService.Object,
                ViewerPreferences.Object,
                OutboxRepository.Object);

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
                TodoRepository.Object,
                OutboxRepository.Object,
                UnitOfWork.Object,
                Mock.Of<ILogger<DeleteTodoCommandHandler>>(),
                CurrentUser.Object);

        public Planora.Todo.Application.Features.Todos.Commands.CreateSubtask.CreateSubtaskCommandHandler CreateSubtaskHandler()
            => new(
                TodoRepository.Object,
                UnitOfWork.Object,
                Mapper.Object,
                Mock.Of<ILogger<Planora.Todo.Application.Features.Todos.Commands.CreateSubtask.CreateSubtaskCommandHandler>>(),
                CurrentUser.Object,
                CategoryGrpcClient.Object);

        public DuplicateTodoCommandHandler CreateDuplicateHandler()
            => new(
                TodoRepository.Object,
                UnitOfWork.Object,
                Mapper.Object,
                Mock.Of<ILogger<DuplicateTodoCommandHandler>>(),
                CurrentUser.Object,
                CategoryGrpcClient.Object,
                FriendshipService.Object,
                OutboxRepository.Object);

        public Planora.Todo.Application.Features.Todos.Queries.GetSubtasks.GetSubtasksQueryHandler CreateGetSubtasksHandler()
            => new(
                TodoRepository.Object,
                CurrentUser.Object,
                Mapper.Object,
                Mock.Of<ILogger<Planora.Todo.Application.Features.Todos.Queries.GetSubtasks.GetSubtasksQueryHandler>>(),
                FriendshipService.Object,
                CategoryGrpcClient.Object,
                UserProfiles.Object);
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
            SharedWithUserIds = item.SharedWith.Select(share => share.SharedWithUserId).ToList(),
            ParentTodoId = item.ParentTodoId
        };
}
