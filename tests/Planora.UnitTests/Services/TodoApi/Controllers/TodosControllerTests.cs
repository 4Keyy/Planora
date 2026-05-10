using Planora.BuildingBlocks.Application.Pagination;
using Planora.Todo.Api.Controllers;
using Planora.Todo.Application.DTOs;
using Planora.Todo.Application.Features.Todos.Commands.CreateTodo;
using Planora.Todo.Application.Features.Todos.Commands.DeleteTodo;
using Planora.Todo.Application.Features.Todos.Commands.SetTodoHidden;
using Planora.Todo.Application.Features.Todos.Commands.SetViewerPreference;
using Planora.Todo.Application.Features.Todos.Commands.UpdateTodo;
using Planora.Todo.Application.Features.Todos.Queries.GetPublicTodos;
using Planora.Todo.Application.Features.Todos.Queries.GetTodoById;
using Planora.Todo.Application.Features.Todos.Queries.GetUserTodos;
using Planora.Todo.Domain.Enums;
using MediatR;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using Moq;
using DomainResult = Planora.BuildingBlocks.Domain.Result;
using HiddenResult = Planora.BuildingBlocks.Domain.Result<Planora.Todo.Application.DTOs.TodoHiddenResponseDto>;
using PagedTodosResult = Planora.BuildingBlocks.Domain.Result<Planora.BuildingBlocks.Application.Pagination.PagedResult<Planora.Todo.Application.DTOs.TodoItemDto>>;
using TodoResult = Planora.BuildingBlocks.Domain.Result<Planora.Todo.Application.DTOs.TodoItemDto>;
using ViewerPreferenceResult = Planora.BuildingBlocks.Domain.Result<Planora.Todo.Application.DTOs.ViewerPreferenceResponseDto>;

namespace Planora.UnitTests.Services.TodoApi.Controllers;

public class TodosControllerTests
{
    [Fact]
    public async Task GetTodos_BuildsQueryFromRouteFilters()
    {
        var mediator = new Mock<IMediator>();
        GetUserTodosQuery? sentQuery = null;
        var paged = new PagedResult<TodoItemDto>([TodoDto()], 2, 25, 51);
        var categoryId = Guid.NewGuid();
        mediator
            .Setup(x => x.Send(It.IsAny<GetUserTodosQuery>(), It.IsAny<CancellationToken>()))
            .Callback<IRequest<PagedResult<TodoItemDto>>, CancellationToken>((query, _) => sentQuery = (GetUserTodosQuery)query)
            .ReturnsAsync(paged);
        var controller = CreateController(mediator);

        var actionResult = await controller.GetTodos(
            pageNumber: 2,
            pageSize: 25,
            status: "done",
            categoryId: categoryId,
            isCompleted: true,
            cancellationToken: CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(actionResult.Result);
        Assert.Same(paged, ok.Value);
        Assert.NotNull(sentQuery);
        Assert.Null(sentQuery.UserId);
        Assert.Equal(2, sentQuery.PageNumber);
        Assert.Equal(25, sentQuery.PageSize);
        Assert.Equal("done", sentQuery.Status);
        Assert.Equal(categoryId, sentQuery.CategoryId);
        Assert.True(sentQuery.IsCompleted);
    }

    [Fact]
    public async Task GetPublicTodos_PassesFriendFilter_AndReturnsMediatorResult()
    {
        var mediator = new Mock<IMediator>();
        GetPublicTodosQuery? sentQuery = null;
        var friendId = Guid.NewGuid();
        var result = PagedTodosResult.Success(new PagedResult<TodoItemDto>([], 1, 10, 0));
        mediator
            .Setup(x => x.Send(It.IsAny<GetPublicTodosQuery>(), It.IsAny<CancellationToken>()))
            .Callback<IRequest<PagedTodosResult>, CancellationToken>((query, _) => sentQuery = (GetPublicTodosQuery)query)
            .ReturnsAsync(result);
        var controller = CreateController(mediator);

        var actionResult = await controller.GetPublicTodos(3, 20, friendId, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(actionResult.Result);
        Assert.Same(result, ok.Value);
        Assert.NotNull(sentQuery);
        Assert.Equal(3, sentQuery.PageNumber);
        Assert.Equal(20, sentQuery.PageSize);
        Assert.Equal(friendId, sentQuery.FriendId);
    }

    [Fact]
    public async Task GetTodoById_MapsSuccessAndNotFound()
    {
        var todoId = Guid.NewGuid();
        var ok = await GetTodoByIdWithResult(todoId, TodoResult.Success(TodoDto(todoId)));
        Assert.IsType<OkObjectResult>(ok.Result);

        var missing = await GetTodoByIdWithResult(todoId, TodoResult.Failure("TODO_NOT_FOUND", "Missing"));
        Assert.IsType<NotFoundObjectResult>(missing.Result);
    }

    [Fact]
    public async Task CreateTodo_MapsSuccessAndBadRequest()
    {
        var todo = TodoDto();
        var created = await CreateTodoWithResult(TodoResult.Success(todo));
        var createdAt = Assert.IsType<CreatedAtActionResult>(created.Result);
        Assert.Equal(nameof(TodosController.GetTodoById), createdAt.ActionName);
        Assert.Equal(todo.Id, createdAt.RouteValues?["id"]);

        var failed = await CreateTodoWithResult(TodoResult.Failure("CATEGORY_FORBIDDEN", "Bad category"));
        Assert.IsType<BadRequestObjectResult>(failed.Result);
    }

    [Fact]
    public async Task UpdateTodo_UsesRouteId_AndMapsFailure()
    {
        var mediator = new Mock<IMediator>();
        UpdateTodoCommand? sentCommand = null;
        var todoId = Guid.NewGuid();
        mediator
            .SetupSequence(x => x.Send(It.IsAny<UpdateTodoCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(TodoResult.Success(TodoDto(todoId)))
            .ReturnsAsync(TodoResult.Failure("TODO_FORBIDDEN", "Denied"));
        mediator
            .Setup(x => x.Send(It.IsAny<UpdateTodoCommand>(), It.IsAny<CancellationToken>()))
            .Callback<IRequest<TodoResult>, CancellationToken>((command, _) => sentCommand = (UpdateTodoCommand)command)
            .ReturnsAsync(TodoResult.Success(TodoDto(todoId)));
        var controller = CreateController(mediator);

        var ok = await controller.UpdateTodo(
            todoId,
            new UpdateTodoCommand(Guid.NewGuid(), Title: "Updated"),
            CancellationToken.None);

        Assert.IsType<OkObjectResult>(ok.Result);
        Assert.NotNull(sentCommand);
        Assert.Equal(todoId, sentCommand.TodoId);

        mediator.Reset();
        mediator
            .Setup(x => x.Send(It.IsAny<UpdateTodoCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(TodoResult.Failure("TODO_FORBIDDEN", "Denied"));
        controller = CreateController(mediator);

        var bad = await controller.UpdateTodo(todoId, new UpdateTodoCommand(todoId), CancellationToken.None);
        Assert.IsType<BadRequestObjectResult>(bad.Result);
    }

    [Fact]
    public async Task DeleteTodo_MapsSuccessAndNotFound()
    {
        var todoId = Guid.NewGuid();

        var success = await DeleteTodoWithResult(todoId, DomainResult.Success());
        Assert.IsType<NoContentResult>(success);

        var missing = await DeleteTodoWithResult(todoId, DomainResult.Failure("TODO_NOT_FOUND", "Missing"));
        Assert.IsType<NotFoundObjectResult>(missing);
    }

    [Fact]
    public async Task SetHidden_BuildsCommand_AndMapsFailure()
    {
        var todoId = Guid.NewGuid();
        var mediator = new Mock<IMediator>();
        SetTodoHiddenCommand? sentCommand = null;
        var response = new TodoHiddenResponseDto
        {
            Id = todoId,
            Hidden = true,
            CategoryId = Guid.NewGuid(),
            CategoryName = "Hidden"
        };
        mediator
            .Setup(x => x.Send(It.IsAny<SetTodoHiddenCommand>(), It.IsAny<CancellationToken>()))
            .Callback<IRequest<HiddenResult>, CancellationToken>((command, _) => sentCommand = (SetTodoHiddenCommand)command)
            .ReturnsAsync(HiddenResult.Success(response));
        var controller = CreateController(mediator);

        var ok = await controller.SetHidden(todoId, new global::SetHiddenRequest(true), CancellationToken.None);

        Assert.IsType<OkObjectResult>(ok.Result);
        Assert.NotNull(sentCommand);
        Assert.Equal(todoId, sentCommand.TodoId);
        Assert.True(sentCommand.Hidden);

        mediator.Reset();
        mediator
            .Setup(x => x.Send(It.IsAny<SetTodoHiddenCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(HiddenResult.Failure("TODO_FORBIDDEN", "Denied"));
        controller = CreateController(mediator);

        var bad = await controller.SetHidden(todoId, new global::SetHiddenRequest(false), CancellationToken.None);
        Assert.IsType<BadRequestObjectResult>(bad.Result);
    }

    [Fact]
    public async Task SetViewerPreference_BuildsCommand_AndMapsFailure()
    {
        var todoId = Guid.NewGuid();
        var categoryId = Guid.NewGuid();
        var mediator = new Mock<IMediator>();
        SetViewerPreferenceCommand? sentCommand = null;
        var response = new ViewerPreferenceResponseDto
        {
            TodoId = todoId,
            HiddenByViewer = true,
            ViewerCategoryId = categoryId
        };
        mediator
            .Setup(x => x.Send(It.IsAny<SetViewerPreferenceCommand>(), It.IsAny<CancellationToken>()))
            .Callback<IRequest<ViewerPreferenceResult>, CancellationToken>((command, _) => sentCommand = (SetViewerPreferenceCommand)command)
            .ReturnsAsync(ViewerPreferenceResult.Success(response));
        var controller = CreateController(mediator);

        var ok = await controller.SetViewerPreference(
            todoId,
            new global::SetViewerPreferenceRequest(true, categoryId, true),
            CancellationToken.None);

        Assert.IsType<OkObjectResult>(ok.Result);
        Assert.NotNull(sentCommand);
        Assert.Equal(todoId, sentCommand.TodoId);
        Assert.True(sentCommand.HiddenByViewer);
        Assert.Equal(categoryId, sentCommand.ViewerCategoryId);
        Assert.True(sentCommand.UpdateViewerCategory);

        mediator.Reset();
        mediator
            .Setup(x => x.Send(It.IsAny<SetViewerPreferenceCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(ViewerPreferenceResult.Failure("OWNER_MUST_USE_HIDDEN_ENDPOINT", "Owner endpoint required"));
        controller = CreateController(mediator);

        var bad = await controller.SetViewerPreference(todoId, new global::SetViewerPreferenceRequest(), CancellationToken.None);
        Assert.IsType<BadRequestObjectResult>(bad.Result);
    }

    private static async Task<ActionResult<TodoItemDto>> GetTodoByIdWithResult(Guid todoId, TodoResult result)
    {
        var mediator = new Mock<IMediator>();
        mediator
            .Setup(x => x.Send(It.IsAny<GetTodoByIdQuery>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(result);
        var controller = CreateController(mediator);

        return await controller.GetTodoById(todoId, CancellationToken.None);
    }

    private static async Task<ActionResult<TodoItemDto>> CreateTodoWithResult(TodoResult result)
    {
        var mediator = new Mock<IMediator>();
        mediator
            .Setup(x => x.Send(It.IsAny<CreateTodoCommand>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(result);
        var controller = CreateController(mediator);

        return await controller.CreateTodo(
            new CreateTodoCommand(null, "Title", null, null, null, null),
            CancellationToken.None);
    }

    private static async Task<IActionResult> DeleteTodoWithResult(Guid todoId, DomainResult result)
    {
        var mediator = new Mock<IMediator>();
        DeleteTodoCommand? sentCommand = null;
        mediator
            .Setup(x => x.Send(It.IsAny<DeleteTodoCommand>(), It.IsAny<CancellationToken>()))
            .Callback<IRequest<DomainResult>, CancellationToken>((command, _) => sentCommand = (DeleteTodoCommand)command)
            .ReturnsAsync(result);
        var controller = CreateController(mediator);

        var actionResult = await controller.DeleteTodo(todoId, CancellationToken.None);

        Assert.NotNull(sentCommand);
        Assert.Equal(todoId, sentCommand.TodoId);
        return actionResult;
    }

    private static TodosController CreateController(Mock<IMediator> mediator)
        => new(
            mediator.Object,
            new Mock<ILogger<TodosController>>().Object)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext()
            }
        };

    private static TodoItemDto TodoDto(Guid? id = null) => new()
    {
        Id = id ?? Guid.NewGuid(),
        UserId = Guid.NewGuid(),
        Title = "Task",
        Status = "todo",
        Priority = TodoPriority.Medium.ToString(),
        IsPublic = false,
        Hidden = false,
        IsCompleted = false,
        Tags = [],
        CreatedAt = DateTime.UtcNow
    };
}
