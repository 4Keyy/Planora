using AutoMapper;
using Planora.BuildingBlocks.Application.Pagination;
using Planora.BuildingBlocks.Domain;
using Planora.BuildingBlocks.Domain.Exceptions;
using Planora.BuildingBlocks.Domain.Interfaces;
using Planora.BuildingBlocks.Infrastructure.Context;
using Planora.Todo.Application.DTOs;
using Planora.Todo.Application.Features.Todos.Commands.AddComment;
using Planora.Todo.Application.Features.Todos.Commands.DeleteComment;
using Planora.Todo.Application.Features.Todos.Commands.JoinTodo;
using Planora.Todo.Application.Features.Todos.Commands.LeaveTodo;
using Planora.Todo.Application.Features.Todos.Commands.UpdateComment;
using Planora.Todo.Application.Features.Todos.Queries.GetComments;
using Planora.Todo.Application.Services;
using Planora.Todo.Domain.Entities;
using Planora.Todo.Domain.Repositories;
using Microsoft.Extensions.Logging;
using Moq;

namespace Planora.UnitTests.Services.TodoApi.Handlers;

public class WorkersAndCommentsHandlerTests
{
    // ═══════════════════════════════════════════════════════════════════════════
    // JoinTodo
    // ═══════════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task JoinTodo_ShouldAddWorkerAndReturnUpdatedDto()
    {
        var ownerId = Guid.NewGuid();
        var workerId = Guid.NewGuid();
        var todo = TodoItem.Create(ownerId, "Public task", isPublic: true);
        var fixture = new WorkerFixture(workerId);

        fixture.Repository.Setup(x => x.GetByIdWithIncludesAsync(todo.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(todo);
        fixture.FriendshipService.Setup(x => x.AreFriendsAsync(workerId, ownerId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);
        fixture.Mapper.Setup(x => x.Map<TodoItemDto>(It.IsAny<TodoItem>())).Returns(EmptyDto());

        var result = await fixture.CreateJoinHandler().Handle(new JoinTodoCommand(todo.Id), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Single(todo.Workers);
        Assert.Equal(1, result.Value!.WorkerCount);
        Assert.True(result.Value.IsWorking);
    }

    [Fact]
    public async Task JoinTodo_WhenOwner_ShouldThrowBusinessRule()
    {
        var ownerId = Guid.NewGuid();
        var todo = TodoItem.Create(ownerId, "Task", isPublic: true);
        var fixture = new WorkerFixture(ownerId);

        fixture.Repository.Setup(x => x.GetByIdWithIncludesAsync(todo.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(todo);

        await Assert.ThrowsAsync<BusinessRuleViolationException>(() =>
            fixture.CreateJoinHandler().Handle(new JoinTodoCommand(todo.Id), CancellationToken.None));
    }

    [Fact]
    public async Task JoinTodo_WhenNoAccess_ShouldThrowForbidden()
    {
        var ownerId = Guid.NewGuid();
        var workerId = Guid.NewGuid();
        // Private task, not shared with workerId
        var todo = TodoItem.Create(ownerId, "Private task");
        var fixture = new WorkerFixture(workerId);

        fixture.Repository.Setup(x => x.GetByIdWithIncludesAsync(todo.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(todo);

        await Assert.ThrowsAsync<ForbiddenException>(() =>
            fixture.CreateJoinHandler().Handle(new JoinTodoCommand(todo.Id), CancellationToken.None));
    }

    [Fact]
    public async Task JoinTodo_WhenNotFriends_ShouldThrowForbidden()
    {
        var ownerId = Guid.NewGuid();
        var workerId = Guid.NewGuid();
        var todo = TodoItem.Create(ownerId, "Public task", isPublic: true);
        var fixture = new WorkerFixture(workerId);

        fixture.Repository.Setup(x => x.GetByIdWithIncludesAsync(todo.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(todo);
        fixture.FriendshipService.Setup(x => x.AreFriendsAsync(workerId, ownerId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(false);

        await Assert.ThrowsAsync<ForbiddenException>(() =>
            fixture.CreateJoinHandler().Handle(new JoinTodoCommand(todo.Id), CancellationToken.None));
    }

    [Fact]
    public async Task JoinTodo_WhenNotFound_ShouldThrowEntityNotFound()
    {
        var fixture = new WorkerFixture(Guid.NewGuid());
        fixture.Repository.Setup(x => x.GetByIdWithIncludesAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((TodoItem?)null);

        await Assert.ThrowsAsync<EntityNotFoundException>(() =>
            fixture.CreateJoinHandler().Handle(new JoinTodoCommand(Guid.NewGuid()), CancellationToken.None));
    }

    [Fact]
    public async Task JoinTodo_WhenCapacityFull_ShouldThrowBusinessRule()
    {
        var ownerId = Guid.NewGuid();
        var existingWorker = Guid.NewGuid();
        var newWorker = Guid.NewGuid();
        // RequiredWorkers = 2 → only 1 non-owner slot
        var todo = TodoItem.Create(ownerId, "Task", isPublic: true, requiredWorkers: 2);
        todo.AddWorker(existingWorker);

        var fixture = new WorkerFixture(newWorker);
        fixture.Repository.Setup(x => x.GetByIdWithIncludesAsync(todo.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(todo);
        fixture.FriendshipService.Setup(x => x.AreFriendsAsync(newWorker, ownerId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);

        await Assert.ThrowsAsync<BusinessRuleViolationException>(() =>
            fixture.CreateJoinHandler().Handle(new JoinTodoCommand(todo.Id), CancellationToken.None));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // LeaveTodo
    // ═══════════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task LeaveTodo_ShouldRemoveWorkerAndReturnSuccess()
    {
        var ownerId = Guid.NewGuid();
        var workerId = Guid.NewGuid();
        var todo = TodoItem.Create(ownerId, "Task", isPublic: true);
        todo.AddWorker(workerId);

        var fixture = new WorkerFixture(workerId);
        fixture.Repository.Setup(x => x.GetByIdWithIncludesAsync(todo.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(todo);

        var result = await fixture.CreateLeaveHandler().Handle(new LeaveTodoCommand(todo.Id), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Empty(todo.Workers);
    }

    [Fact]
    public async Task LeaveTodo_WhenOwner_ShouldThrowBusinessRule()
    {
        var ownerId = Guid.NewGuid();
        var todo = TodoItem.Create(ownerId, "Task");
        var fixture = new WorkerFixture(ownerId);

        fixture.Repository.Setup(x => x.GetByIdWithIncludesAsync(todo.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(todo);

        await Assert.ThrowsAsync<BusinessRuleViolationException>(() =>
            fixture.CreateLeaveHandler().Handle(new LeaveTodoCommand(todo.Id), CancellationToken.None));
    }

    [Fact]
    public async Task LeaveTodo_WhenNotWorker_ShouldThrowEntityNotFound()
    {
        var ownerId = Guid.NewGuid();
        var userId = Guid.NewGuid();
        var todo = TodoItem.Create(ownerId, "Task", isPublic: true);
        var fixture = new WorkerFixture(userId);

        fixture.Repository.Setup(x => x.GetByIdWithIncludesAsync(todo.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(todo);

        await Assert.ThrowsAsync<EntityNotFoundException>(() =>
            fixture.CreateLeaveHandler().Handle(new LeaveTodoCommand(todo.Id), CancellationToken.None));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // AddComment
    // ═══════════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task AddComment_ByOwner_ShouldSucceed()
    {
        var ownerId = Guid.NewGuid();
        var todo = TodoItem.Create(ownerId, "Task", isPublic: true);
        var fixture = new CommentFixture(ownerId, "Owner Name");

        fixture.TodoRepository.Setup(x => x.GetByIdWithIncludesAsync(todo.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(todo);

        var result = await fixture.CreateAddHandler().Handle(
            new AddCommentCommand(todo.Id, "Great task!"), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal("Great task!", result.Value!.Content);
        Assert.True(result.Value.IsOwn);
        Assert.False(result.Value.IsEdited);
        Assert.Null(result.Value.UpdatedAt);
    }

    [Fact]
    public async Task AddComment_ByWorker_ShouldSucceed()
    {
        var ownerId = Guid.NewGuid();
        var workerId = Guid.NewGuid();
        var todo = TodoItem.Create(ownerId, "Task", isPublic: true);
        todo.AddWorker(workerId);

        var fixture = new CommentFixture(workerId, "Worker Name");
        fixture.TodoRepository.Setup(x => x.GetByIdWithIncludesAsync(todo.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(todo);
        fixture.FriendshipService.Setup(x => x.AreFriendsAsync(workerId, ownerId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);

        var result = await fixture.CreateAddHandler().Handle(
            new AddCommentCommand(todo.Id, "My comment"), CancellationToken.None);

        Assert.True(result.IsSuccess);
    }

    [Fact]
    public async Task AddComment_ByNonWorkerFriend_ShouldThrowForbidden()
    {
        var ownerId = Guid.NewGuid();
        var nonWorkerId = Guid.NewGuid();
        var todo = TodoItem.Create(ownerId, "Task", isPublic: true);

        var fixture = new CommentFixture(nonWorkerId, "Viewer");
        fixture.TodoRepository.Setup(x => x.GetByIdWithIncludesAsync(todo.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(todo);
        fixture.FriendshipService.Setup(x => x.AreFriendsAsync(nonWorkerId, ownerId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);

        await Assert.ThrowsAsync<ForbiddenException>(() =>
            fixture.CreateAddHandler().Handle(
                new AddCommentCommand(todo.Id, "Can I comment?"), CancellationToken.None));
    }

    [Fact]
    public async Task AddComment_WithNoAccess_ShouldThrowForbidden()
    {
        var ownerId = Guid.NewGuid();
        var strangerId = Guid.NewGuid();
        var todo = TodoItem.Create(ownerId, "Private task"); // not public, not shared
        var fixture = new CommentFixture(strangerId, "Stranger");

        fixture.TodoRepository.Setup(x => x.GetByIdWithIncludesAsync(todo.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(todo);

        await Assert.ThrowsAsync<ForbiddenException>(() =>
            fixture.CreateAddHandler().Handle(
                new AddCommentCommand(todo.Id, "Hack!"), CancellationToken.None));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // UpdateComment
    // ═══════════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task UpdateComment_ByAuthor_ShouldReturnUpdatedDto()
    {
        var authorId = Guid.NewGuid();
        var todoId = Guid.NewGuid();
        var comment = TodoItemComment.Create(todoId, authorId, "Alice", "Original");
        var fixture = new CommentFixture(authorId, "Alice");

        fixture.CommentRepository.Setup(x => x.GetByIdAsync(comment.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(comment);

        var result = await fixture.CreateUpdateHandler().Handle(
            new UpdateCommentCommand(todoId, comment.Id, "Updated content"), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal("Updated content", result.Value!.Content);
        Assert.True(result.Value.IsOwn);
    }

    [Fact]
    public async Task UpdateComment_ByNonAuthor_ShouldThrowForbidden()
    {
        var authorId = Guid.NewGuid();
        var todoId = Guid.NewGuid();
        var comment = TodoItemComment.Create(todoId, authorId, "Alice", "Original");
        var otherUser = Guid.NewGuid();
        var fixture = new CommentFixture(otherUser, "Bob");

        fixture.CommentRepository.Setup(x => x.GetByIdAsync(comment.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(comment);

        await Assert.ThrowsAsync<ForbiddenException>(() =>
            fixture.CreateUpdateHandler().Handle(
                new UpdateCommentCommand(todoId, comment.Id, "Hacked"), CancellationToken.None));
    }

    [Fact]
    public async Task UpdateComment_WithWrongTodoId_ShouldThrowEntityNotFound()
    {
        var authorId = Guid.NewGuid();
        var correctTodoId = Guid.NewGuid();
        var wrongTodoId = Guid.NewGuid();
        var comment = TodoItemComment.Create(correctTodoId, authorId, "Alice", "Content");
        var fixture = new CommentFixture(authorId, "Alice");

        fixture.CommentRepository.Setup(x => x.GetByIdAsync(comment.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(comment);

        await Assert.ThrowsAsync<EntityNotFoundException>(() =>
            fixture.CreateUpdateHandler().Handle(
                new UpdateCommentCommand(wrongTodoId, comment.Id, "Content"), CancellationToken.None));
    }

    [Fact]
    public async Task UpdateComment_WhenNotFound_ShouldThrowEntityNotFound()
    {
        var fixture = new CommentFixture(Guid.NewGuid(), "User");
        fixture.CommentRepository.Setup(x => x.GetByIdAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((TodoItemComment?)null);

        await Assert.ThrowsAsync<EntityNotFoundException>(() =>
            fixture.CreateUpdateHandler().Handle(
                new UpdateCommentCommand(Guid.NewGuid(), Guid.NewGuid(), "Content"), CancellationToken.None));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // DeleteComment
    // ═══════════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task DeleteComment_ByAuthor_ShouldSoftDelete()
    {
        var ownerId = Guid.NewGuid();
        var authorId = Guid.NewGuid();
        var todoId = Guid.NewGuid();
        var comment = TodoItemComment.Create(todoId, authorId, "Alice", "Delete me");
        var todo = TodoItem.Create(ownerId, "Task", isPublic: true);
        var fixture = new CommentFixture(authorId, "Alice");

        fixture.CommentRepository.Setup(x => x.GetByIdAsync(comment.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(comment);
        fixture.TodoRepository.Setup(x => x.GetByIdWithIncludesAsync(todoId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(todo);

        var result = await fixture.CreateDeleteHandler().Handle(
            new DeleteCommentCommand(todoId, comment.Id), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.True(comment.IsDeleted);
    }

    [Fact]
    public async Task DeleteComment_ByTodoOwner_ShouldSoftDelete()
    {
        var ownerId = Guid.NewGuid();
        var authorId = Guid.NewGuid();
        var todoId = Guid.NewGuid();
        var comment = TodoItemComment.Create(todoId, authorId, "Alice", "Inappropriate");
        var todo = TodoItem.Create(ownerId, "Task", isPublic: true);
        var fixture = new CommentFixture(ownerId, "Owner");

        fixture.CommentRepository.Setup(x => x.GetByIdAsync(comment.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(comment);
        fixture.TodoRepository.Setup(x => x.GetByIdWithIncludesAsync(todoId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(todo);

        var result = await fixture.CreateDeleteHandler().Handle(
            new DeleteCommentCommand(todoId, comment.Id), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.True(comment.IsDeleted);
    }

    [Fact]
    public async Task DeleteComment_ByUnauthorizedUser_ShouldThrowForbidden()
    {
        var ownerId = Guid.NewGuid();
        var authorId = Guid.NewGuid();
        var thirdParty = Guid.NewGuid();
        var todoId = Guid.NewGuid();
        var comment = TodoItemComment.Create(todoId, authorId, "Alice", "Content");
        var todo = TodoItem.Create(ownerId, "Task", isPublic: true);
        var fixture = new CommentFixture(thirdParty, "Third");

        fixture.CommentRepository.Setup(x => x.GetByIdAsync(comment.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(comment);
        fixture.TodoRepository.Setup(x => x.GetByIdWithIncludesAsync(todoId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(todo);

        await Assert.ThrowsAsync<ForbiddenException>(() =>
            fixture.CreateDeleteHandler().Handle(
                new DeleteCommentCommand(todoId, comment.Id), CancellationToken.None));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // GetComments
    // ═══════════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task GetComments_ByOwner_ShouldReturnPagedComments()
    {
        var ownerId = Guid.NewGuid();
        var todoId = Guid.NewGuid();
        var todo = TodoItem.Create(ownerId, "Task", isPublic: true);
        var c1 = TodoItemComment.Create(todoId, ownerId, "Owner", "First comment");
        var c2 = TodoItemComment.Create(todoId, Guid.NewGuid(), "Worker", "Second comment");

        var fixture = new CommentFixture(ownerId, "Owner");
        fixture.TodoRepository.Setup(x => x.GetByIdWithIncludesAsync(todo.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(todo);
        fixture.CommentRepository.Setup(x => x.GetPagedByTodoIdAsync(todo.Id, 1, 50, It.IsAny<CancellationToken>()))
            .ReturnsAsync(((IReadOnlyList<TodoItemComment>)[c1, c2], 2));

        var result = await fixture.CreateGetCommentsHandler().Handle(
            new GetCommentsQuery(todo.Id), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(2, result.Value!.Items.Count);
        Assert.True(result.Value.Items[0].IsOwn);  // c1 is by owner
        Assert.False(result.Value.Items[1].IsOwn); // c2 is by someone else
    }

    [Fact]
    public async Task GetComments_WithNoAccess_ShouldThrowForbidden()
    {
        var ownerId = Guid.NewGuid();
        var strangerId = Guid.NewGuid();
        var todo = TodoItem.Create(ownerId, "Private task");
        var fixture = new CommentFixture(strangerId, "Stranger");

        fixture.TodoRepository.Setup(x => x.GetByIdWithIncludesAsync(todo.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(todo);

        await Assert.ThrowsAsync<ForbiddenException>(() =>
            fixture.CreateGetCommentsHandler().Handle(
                new GetCommentsQuery(todo.Id), CancellationToken.None));
    }

    [Fact]
    public async Task GetComments_WithMissingAuthContext_ShouldReturnFailure()
    {
        var fixture = new CommentFixture(Guid.Empty, null); // Empty userId = unauthenticated

        var result = await fixture.CreateGetCommentsHandler().Handle(
            new GetCommentsQuery(Guid.NewGuid()), CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("AUTH_REQUIRED", result.Error!.Code);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Fixtures
    // ═══════════════════════════════════════════════════════════════════════════

    private sealed class WorkerFixture
    {
        public Mock<ITodoRepository> Repository { get; } = new();
        public Mock<IUnitOfWork> UnitOfWork { get; } = new();
        public Mock<IMapper> Mapper { get; } = new();
        public Mock<ICurrentUserContext> CurrentUser { get; } = new();
        public Mock<IFriendshipService> FriendshipService { get; } = new();

        public WorkerFixture(Guid userId)
        {
            CurrentUser.SetupGet(x => x.UserId).Returns(userId);
            CurrentUser.SetupGet(x => x.IsAuthenticated).Returns(userId != Guid.Empty);
            UnitOfWork.Setup(x => x.SaveChangesAsync(It.IsAny<CancellationToken>())).ReturnsAsync(1);
            Repository.Setup(x => x.Update(It.IsAny<TodoItem>()));
        }

        public JoinTodoCommandHandler CreateJoinHandler()
            => new(Repository.Object, UnitOfWork.Object, Mapper.Object, CurrentUser.Object, FriendshipService.Object);

        public LeaveTodoCommandHandler CreateLeaveHandler()
            => new(Repository.Object, UnitOfWork.Object, CurrentUser.Object);
    }

    private sealed class CommentFixture
    {
        public Mock<ITodoRepository> TodoRepository { get; } = new();
        public Mock<ITodoCommentRepository> CommentRepository { get; } = new();
        public Mock<IUnitOfWork> UnitOfWork { get; } = new();
        public Mock<ICurrentUserContext> CurrentUser { get; } = new();
        public Mock<IFriendshipService> FriendshipService { get; } = new();

        public CommentFixture(Guid userId, string? name)
        {
            CurrentUser.SetupGet(x => x.UserId).Returns(userId);
            CurrentUser.SetupGet(x => x.IsAuthenticated).Returns(userId != Guid.Empty);
            CurrentUser.SetupGet(x => x.Name).Returns(name);
            UnitOfWork.Setup(x => x.SaveChangesAsync(It.IsAny<CancellationToken>())).ReturnsAsync(1);
            CommentRepository.Setup(x => x.AddAsync(It.IsAny<TodoItemComment>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync((TodoItemComment c, CancellationToken _) => c);
            CommentRepository.Setup(x => x.Update(It.IsAny<TodoItemComment>()));
        }

        public AddCommentCommandHandler CreateAddHandler()
            => new(TodoRepository.Object, CommentRepository.Object, UnitOfWork.Object,
                CurrentUser.Object, FriendshipService.Object);

        public UpdateCommentCommandHandler CreateUpdateHandler()
            => new(CommentRepository.Object, UnitOfWork.Object, CurrentUser.Object);

        public DeleteCommentCommandHandler CreateDeleteHandler()
            => new(CommentRepository.Object, TodoRepository.Object, UnitOfWork.Object, CurrentUser.Object);

        public GetCommentsQueryHandler CreateGetCommentsHandler()
            => new(TodoRepository.Object, CommentRepository.Object, CurrentUser.Object, FriendshipService.Object);
    }

    private static TodoItemDto EmptyDto() => new()
    {
        Id = Guid.NewGuid(),
        UserId = Guid.NewGuid(),
        Title = "T",
        Status = "todo",
        Priority = "Medium",
        IsPublic = false,
        Hidden = false,
        IsCompleted = false,
        Tags = [],
        CreatedAt = DateTime.UtcNow,
    };
}
