using Planora.BuildingBlocks.Application.Pagination;
using Planora.BuildingBlocks.Domain;
using Planora.Todo.Api.Controllers;
using Planora.Todo.Application.DTOs;
using Planora.Todo.Application.Features.Todos.Commands.AddComment;
using Planora.Todo.Application.Features.Todos.Commands.DeleteComment;
using Planora.Todo.Application.Features.Todos.Commands.JoinTodo;
using Planora.Todo.Application.Features.Todos.Commands.LeaveTodo;
using Planora.Todo.Application.Features.Todos.Commands.UpdateComment;
using Planora.Todo.Application.Features.Todos.Queries.GetComments;
using Planora.Todo.Domain.Enums;
using MediatR;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using Moq;
using DomainResult = Planora.BuildingBlocks.Domain.Result;
using CommentResult = Planora.BuildingBlocks.Domain.Result<Planora.Todo.Application.DTOs.TodoCommentDto>;
using PagedCommentResult = Planora.BuildingBlocks.Domain.Result<Planora.BuildingBlocks.Application.Pagination.PagedResult<Planora.Todo.Application.DTOs.TodoCommentDto>>;
using TodoResult = Planora.BuildingBlocks.Domain.Result<Planora.Todo.Application.DTOs.TodoItemDto>;

namespace Planora.UnitTests.Services.TodoApi.Controllers;

public class TodosWorkerCommentControllerTests
{
    // ─── JoinTodo ─────────────────────────────────────────────────────────────

    [Fact]
    public async Task JoinTodo_ReturnsOk_OnSuccess()
    {
        var todoId = Guid.NewGuid();
        var dto = MakeTodoDto(todoId, isWorking: true, workerCount: 1);
        var mediator = SetupMediator<JoinTodoCommand, TodoResult>(TodoResult.Success(dto));
        var controller = CreateController(mediator);

        var result = await controller.JoinTodo(todoId, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        Assert.Same(dto, ok.Value);
    }

    [Fact]
    public async Task JoinTodo_ReturnsBadRequest_OnFailure()
    {
        var mediator = SetupMediator<JoinTodoCommand, TodoResult>(
            TodoResult.Failure("CAPACITY_FULL", "Task is full"));
        var controller = CreateController(mediator);

        var result = await controller.JoinTodo(Guid.NewGuid(), CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    [Fact]
    public async Task JoinTodo_SendsCommandWithCorrectTodoId()
    {
        var todoId = Guid.NewGuid();
        JoinTodoCommand? sent = null;
        var mediator = new Mock<IMediator>();
        mediator.Setup(x => x.Send(It.IsAny<JoinTodoCommand>(), It.IsAny<CancellationToken>()))
            .Callback<IRequest<TodoResult>, CancellationToken>((cmd, _) => sent = (JoinTodoCommand)cmd)
            .ReturnsAsync(TodoResult.Success(MakeTodoDto(todoId)));
        var controller = CreateController(mediator);

        await controller.JoinTodo(todoId, CancellationToken.None);

        Assert.NotNull(sent);
        Assert.Equal(todoId, sent.TodoId);
    }

    // ─── LeaveTodo ────────────────────────────────────────────────────────────

    [Fact]
    public async Task LeaveTodo_ReturnsNoContent_OnSuccess()
    {
        var mediator = SetupMediator<LeaveTodoCommand, DomainResult>(DomainResult.Success());
        var controller = CreateController(mediator);

        var result = await controller.LeaveTodo(Guid.NewGuid(), CancellationToken.None);

        Assert.IsType<NoContentResult>(result);
    }

    [Fact]
    public async Task LeaveTodo_ReturnsBadRequest_OnFailure()
    {
        var mediator = SetupMediator<LeaveTodoCommand, DomainResult>(
            DomainResult.Failure("NOT_A_WORKER", "You are not a worker"));
        var controller = CreateController(mediator);

        var result = await controller.LeaveTodo(Guid.NewGuid(), CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result);
    }

    // ─── GetComments ──────────────────────────────────────────────────────────

    [Fact]
    public async Task GetComments_ReturnsOk_WithPagedResult()
    {
        var todoId = Guid.NewGuid();
        var comments = new PagedResult<TodoCommentDto>([MakeCommentDto()], 1, 50, 1);
        var mediator = SetupMediator<GetCommentsQuery, PagedCommentResult>(PagedCommentResult.Success(comments));
        var controller = CreateController(mediator);

        var result = await controller.GetComments(todoId, 1, 50, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        Assert.Same(comments, ok.Value);
    }

    [Fact]
    public async Task GetComments_SendsQueryWithCorrectParameters()
    {
        var todoId = Guid.NewGuid();
        GetCommentsQuery? sent = null;
        var mediator = new Mock<IMediator>();
        mediator.Setup(x => x.Send(It.IsAny<GetCommentsQuery>(), It.IsAny<CancellationToken>()))
            .Callback<IRequest<PagedCommentResult>, CancellationToken>((q, _) => sent = (GetCommentsQuery)q)
            .ReturnsAsync(PagedCommentResult.Success(new PagedResult<TodoCommentDto>([], 2, 25, 0)));
        var controller = CreateController(mediator);

        await controller.GetComments(todoId, 2, 25, CancellationToken.None);

        Assert.NotNull(sent);
        Assert.Equal(todoId, sent.TodoId);
        Assert.Equal(2, sent.PageNumber);
        Assert.Equal(25, sent.PageSize);
    }

    [Fact]
    public async Task GetComments_ReturnsBadRequest_OnFailure()
    {
        var mediator = SetupMediator<GetCommentsQuery, PagedCommentResult>(
            PagedCommentResult.Failure("AUTH_REQUIRED", "Not authenticated"));
        var controller = CreateController(mediator);

        var result = await controller.GetComments(Guid.NewGuid(), 1, 50, CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    // ─── AddComment ───────────────────────────────────────────────────────────

    [Fact]
    public async Task AddComment_Returns201Created_OnSuccess()
    {
        var commentDto = MakeCommentDto();
        var mediator = SetupMediator<AddCommentCommand, CommentResult>(CommentResult.Success(commentDto));
        var controller = CreateController(mediator);

        var result = await controller.AddComment(
            Guid.NewGuid(),
            new global::AddCommentRequest("Hello!"),
            CancellationToken.None);

        var created = Assert.IsType<ObjectResult>(result.Result);
        Assert.Equal(StatusCodes.Status201Created, created.StatusCode);
        Assert.Same(commentDto, created.Value);
    }

    [Fact]
    public async Task AddComment_SendsCommandWithCorrectContent()
    {
        var todoId = Guid.NewGuid();
        AddCommentCommand? sent = null;
        var mediator = new Mock<IMediator>();
        mediator.Setup(x => x.Send(It.IsAny<AddCommentCommand>(), It.IsAny<CancellationToken>()))
            .Callback<IRequest<CommentResult>, CancellationToken>((cmd, _) => sent = (AddCommentCommand)cmd)
            .ReturnsAsync(CommentResult.Success(MakeCommentDto()));
        var controller = CreateController(mediator);

        await controller.AddComment(todoId, new global::AddCommentRequest("My comment"), CancellationToken.None);

        Assert.NotNull(sent);
        Assert.Equal(todoId, sent.TodoId);
        Assert.Equal("My comment", sent.Content);
    }

    [Fact]
    public async Task AddComment_ReturnsBadRequest_OnFailure()
    {
        var mediator = SetupMediator<AddCommentCommand, CommentResult>(
            CommentResult.Failure("NOT_A_WORKER", "You must be a worker to comment"));
        var controller = CreateController(mediator);

        var result = await controller.AddComment(
            Guid.NewGuid(),
            new global::AddCommentRequest("content"),
            CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    // ─── UpdateComment ────────────────────────────────────────────────────────

    [Fact]
    public async Task UpdateComment_ReturnsOk_OnSuccess()
    {
        var commentDto = MakeCommentDto();
        var mediator = SetupMediator<UpdateCommentCommand, CommentResult>(CommentResult.Success(commentDto));
        var controller = CreateController(mediator);

        var result = await controller.UpdateComment(
            Guid.NewGuid(),
            Guid.NewGuid(),
            new global::UpdateCommentRequest("Updated"),
            CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(result.Result);
        Assert.Same(commentDto, ok.Value);
    }

    [Fact]
    public async Task UpdateComment_SendsCommandWithCorrectIds()
    {
        var todoId = Guid.NewGuid();
        var commentId = Guid.NewGuid();
        UpdateCommentCommand? sent = null;
        var mediator = new Mock<IMediator>();
        mediator.Setup(x => x.Send(It.IsAny<UpdateCommentCommand>(), It.IsAny<CancellationToken>()))
            .Callback<IRequest<CommentResult>, CancellationToken>((cmd, _) => sent = (UpdateCommentCommand)cmd)
            .ReturnsAsync(CommentResult.Success(MakeCommentDto()));
        var controller = CreateController(mediator);

        await controller.UpdateComment(todoId, commentId,
            new global::UpdateCommentRequest("New content"), CancellationToken.None);

        Assert.NotNull(sent);
        Assert.Equal(todoId, sent.TodoId);
        Assert.Equal(commentId, sent.CommentId);
        Assert.Equal("New content", sent.Content);
    }

    [Fact]
    public async Task UpdateComment_ReturnsBadRequest_OnFailure()
    {
        var mediator = SetupMediator<UpdateCommentCommand, CommentResult>(
            CommentResult.Failure("FORBIDDEN", "Not author"));
        var controller = CreateController(mediator);

        var result = await controller.UpdateComment(
            Guid.NewGuid(), Guid.NewGuid(),
            new global::UpdateCommentRequest("x"), CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result.Result);
    }

    // ─── DeleteComment ────────────────────────────────────────────────────────

    [Fact]
    public async Task DeleteComment_ReturnsNoContent_OnSuccess()
    {
        var mediator = SetupMediator<DeleteCommentCommand, DomainResult>(DomainResult.Success());
        var controller = CreateController(mediator);

        var result = await controller.DeleteComment(Guid.NewGuid(), Guid.NewGuid(), CancellationToken.None);

        Assert.IsType<NoContentResult>(result);
    }

    [Fact]
    public async Task DeleteComment_SendsCommandWithCorrectIds()
    {
        var todoId = Guid.NewGuid();
        var commentId = Guid.NewGuid();
        DeleteCommentCommand? sent = null;
        var mediator = new Mock<IMediator>();
        mediator.Setup(x => x.Send(It.IsAny<DeleteCommentCommand>(), It.IsAny<CancellationToken>()))
            .Callback<IRequest<DomainResult>, CancellationToken>((cmd, _) => sent = (DeleteCommentCommand)cmd)
            .ReturnsAsync(DomainResult.Success());
        var controller = CreateController(mediator);

        await controller.DeleteComment(todoId, commentId, CancellationToken.None);

        Assert.NotNull(sent);
        Assert.Equal(todoId, sent.TodoId);
        Assert.Equal(commentId, sent.CommentId);
    }

    [Fact]
    public async Task DeleteComment_ReturnsBadRequest_OnFailure()
    {
        var mediator = SetupMediator<DeleteCommentCommand, DomainResult>(
            DomainResult.Failure("FORBIDDEN", "Not authorized"));
        var controller = CreateController(mediator);

        var result = await controller.DeleteComment(Guid.NewGuid(), Guid.NewGuid(), CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result);
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    private static Mock<IMediator> SetupMediator<TRequest, TResponse>(TResponse response)
        where TRequest : IRequest<TResponse>
    {
        var mediator = new Mock<IMediator>();
        mediator.Setup(x => x.Send(It.IsAny<TRequest>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(response);
        return mediator;
    }

    private static TodosController CreateController(Mock<IMediator> mediator)
        => new(mediator.Object, new Mock<ILogger<TodosController>>().Object)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() }
        };

    private static TodoItemDto MakeTodoDto(Guid? id = null, bool isWorking = false, int workerCount = 0) => new()
    {
        Id = id ?? Guid.NewGuid(),
        UserId = Guid.NewGuid(),
        Title = "Task",
        Status = "todo",
        Priority = TodoPriority.Medium.ToString(),
        IsPublic = true,
        Hidden = false,
        IsCompleted = false,
        Tags = [],
        CreatedAt = DateTime.UtcNow,
        IsWorking = isWorking,
        WorkerCount = workerCount,
    };

    private static TodoCommentDto MakeCommentDto() => new(
        Id: Guid.NewGuid(),
        TodoItemId: Guid.NewGuid(),
        AuthorId: Guid.NewGuid(),
        AuthorName: "Author",
        Content: "A comment",
        CreatedAt: DateTime.UtcNow,
        UpdatedAt: null,
        IsOwn: true,
        IsEdited: false);
}
