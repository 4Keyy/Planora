using Grpc.Core;
using Planora.GrpcContracts;
using Planora.Todo.Application.Features.Todos.Commands.CreateTodo;
using Planora.Todo.Application.Features.Todos.Commands.DeleteTodo;
using Planora.Todo.Application.Features.Todos.Commands.UpdateTodo;
using Planora.Todo.Application.Features.Todos.Queries.GetTodosByCategory;
using Planora.Todo.Application.Features.Todos.Queries.GetUserTodos;
using MediatR;

namespace Planora.Todo.Api.Grpc;

public class TodoGrpcService : TodoService.TodoServiceBase
{
    private readonly IMediator _mediator;
    private readonly ILogger<TodoGrpcService> _logger;

    public TodoGrpcService(IMediator mediator, ILogger<TodoGrpcService> logger)
    {
        _mediator = mediator;
        _logger = logger;
    }

    public override async Task<GetUserTodosResponse> GetUserTodos(GetUserTodosRequest request, ServerCallContext context)
    {
        var query = new GetUserTodosQuery(
            string.IsNullOrEmpty(request.UserId) ? null : Guid.Parse(request.UserId),
            request.Page,
            request.PageSize);

        var result = await _mediator.Send(query);

        var response = new GetUserTodosResponse
        {
            TotalCount = result.TotalCount
        };

        response.Todos.AddRange(result.Items.Select(t => new TodoItemModel
        {
            Id = t.Id.ToString(),
            Title = t.Title,
            UserId = t.UserId.ToString(),
            CategoryId = t.CategoryId?.ToString() ?? "",
            IsCompleted = t.IsCompleted,
            CreatedAt = t.CreatedAt.ToString(),
            SharedWithUserIds = { t.SharedWithUserIds.Select(id => id.ToString()) }
        }));

        return response;
    }

    public override async Task<GetTodosByCategoryResponse> GetTodosByCategory(GetTodosByCategoryRequest request, ServerCallContext context)
    {
        var query = new GetTodosByCategoryQuery(
            Guid.Parse(request.CategoryId),
            string.IsNullOrEmpty(request.UserId) ? null : Guid.Parse(request.UserId),
            request.Page,
            request.PageSize);

        var result = await _mediator.Send(query);

        if (result.IsFailure)
        {
            throw new RpcException(new global::Grpc.Core.Status(global::Grpc.Core.StatusCode.Internal, result.Error?.Message ?? "Unknown Error"));
        }

        var response = new GetTodosByCategoryResponse
        {
            TotalCount = result.Value?.TotalCount ?? 0
        };

        response.Todos.AddRange(result.Value?.Items.Select(t => new TodoItemModel
        {
            Id = t.Id.ToString(),
            Title = t.Title,
            UserId = t.UserId.ToString(),
            CategoryId = t.CategoryId?.ToString() ?? "",
            IsCompleted = t.IsCompleted,
            CreatedAt = t.CreatedAt.ToString()
        }));

        return response;
    }

    public override async Task<CreateTodoResponse> CreateTodo(CreateTodoRequest request, ServerCallContext context)
    {
        var sharedWith = request.SharedWithUserIds
            .Select(id => Guid.TryParse(id, out var parsed) ? parsed : Guid.Empty)
            .Where(id => id != Guid.Empty)
            .ToList();

        var command = new CreateTodoCommand(
            string.IsNullOrEmpty(request.UserId) ? null : Guid.Parse(request.UserId),
            request.Title,
            null, // Description
            string.IsNullOrEmpty(request.CategoryId) ? null : Guid.Parse(request.CategoryId),
            null, // DueDate
            null, // ExpectedDate
            SharedWithUserIds: sharedWith
        );

        var result = await _mediator.Send(command);

        if (result.IsFailure)
        {
            throw new RpcException(new global::Grpc.Core.Status(global::Grpc.Core.StatusCode.Internal, result.Error?.Message ?? "Unknown Error"));
        }

        return new CreateTodoResponse
        {
            Id = result.Value?.Id.ToString() ?? string.Empty
        };
    }

    public override async Task<UpdateTodoResponse> UpdateTodo(UpdateTodoRequest request, ServerCallContext context)
    {
        var sharedWith = request.SharedWithUserIds
            .Select(id => Guid.TryParse(id, out var parsed) ? parsed : Guid.Empty)
            .Where(id => id != Guid.Empty)
            .ToList();

        var command = new UpdateTodoCommand(
            TodoId: Guid.Parse(request.Id),
            Title: request.Title,
            SharedWithUserIds: sharedWith,
            Status: request.IsCompleted ? "Done" : "Todo");

        await _mediator.Send(command);

        return new UpdateTodoResponse
        {
            Success = true
        };
    }

    public override async Task<DeleteTodoResponse> DeleteTodo(DeleteTodoRequest request, ServerCallContext context)
    {
        var command = new DeleteTodoCommand(Guid.Parse(request.Id));
        await _mediator.Send(command);

        return new DeleteTodoResponse
        {
            Success = true
        };
    }
}
