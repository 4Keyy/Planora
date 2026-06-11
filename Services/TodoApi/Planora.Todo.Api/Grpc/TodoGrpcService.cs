using Grpc.Core;
using Planora.GrpcContracts;
using Planora.Todo.Application.Features.Todos.Commands.CreateTodo;
using Planora.Todo.Application.Features.Todos.Commands.DeleteTodo;
using Planora.Todo.Application.Features.Todos.Commands.UpdateTodo;
using Planora.Todo.Application.Features.Todos.Queries.GetTodosByCategory;
using Planora.Todo.Application.Features.Todos.Queries.GetUserTodos;
using Planora.Todo.Application.Services;
using Planora.Todo.Domain.Repositories;
using MediatR;

namespace Planora.Todo.Api.Grpc;

public class TodoGrpcService : TodoService.TodoServiceBase
{
    private readonly IMediator _mediator;
    private readonly ITodoRepository _todoRepository;
    private readonly IFriendshipService _friendshipService;
    private readonly ILogger<TodoGrpcService> _logger;

    public TodoGrpcService(
        IMediator mediator,
        ITodoRepository todoRepository,
        IFriendshipService friendshipService,
        ILogger<TodoGrpcService> logger)
    {
        _mediator = mediator;
        _todoRepository = todoRepository;
        _friendshipService = friendshipService;
        _logger = logger;
    }

    /// <summary>
    /// Authorises a comment/timeline operation for a task. Encapsulates the exact
    /// ownership / sharing / public + friendship rules the comment handlers used to apply,
    /// so the Collaboration service never reads Todo's database (INV-OWN-1).
    /// </summary>
    public override async Task<CheckTaskCommentAccessResponse> CheckTaskCommentAccess(
        CheckTaskCommentAccessRequest request, ServerCallContext context)
    {
        if (!Guid.TryParse(request.TaskId, out var taskId) ||
            !Guid.TryParse(request.RequesterId, out var requesterId))
        {
            throw new RpcException(new global::Grpc.Core.Status(
                global::Grpc.Core.StatusCode.InvalidArgument, "task_id and requester_id must be valid GUIDs"));
        }

        var todoItem = await _todoRepository.GetByIdWithIncludesAsync(taskId, context.CancellationToken);
        if (todoItem is null)
        {
            return new CheckTaskCommentAccessResponse { Exists = false, HasAccess = false, OwnerId = string.Empty };
        }

        var isOwner = todoItem.UserId == requesterId;
        var isSharedDirectly = todoItem.SharedWith.Any(s => s.SharedWithUserId == requesterId);
        var hasVisibility = todoItem.IsPublic || isSharedDirectly;
        var isFriend = hasVisibility && !isOwner
            && await _friendshipService.AreFriendsAsync(requesterId, todoItem.UserId, context.CancellationToken);
        var hasAccess = isOwner || (isSharedDirectly && isFriend) || (todoItem.IsPublic && isFriend);

        var response = new CheckTaskCommentAccessResponse
        {
            Exists = true,
            HasAccess = hasAccess,
            OwnerId = todoItem.UserId.ToString(),
            // Single source of truth for the description — Collaboration synthesises the
            // pinned "Author's Note" from this instead of storing a genesis comment copy.
            Description = todoItem.Description ?? string.Empty,
            TaskCreatedAt = todoItem.CreatedAt.ToString("o"),
        };

        // Notification recipients: owner + workers + shared-with audience.
        var participants = new HashSet<Guid> { todoItem.UserId };
        foreach (var w in todoItem.Workers) participants.Add(w.UserId);
        foreach (var s in todoItem.SharedWith) participants.Add(s.SharedWithUserId);
        response.ParticipantIds.AddRange(participants.Where(id => id != Guid.Empty).Select(id => id.ToString()));

        return response;
    }

    /// <summary>
    /// Validates a subtask as a reply target inside its parent task's branch. Returns the data
    /// Collaboration snapshots on the reply (title preview + author id). The parent/child check
    /// lives here because only Todo owns the task aggregate (INV-OWN-1). Authorisation is NOT
    /// repeated here — the caller has already authorised the requester against the parent task
    /// via <see cref="CheckTaskCommentAccess"/> in the same operation.
    /// </summary>
    public override async Task<GetSubtaskBriefResponse> GetSubtaskBrief(
        GetSubtaskBriefRequest request, ServerCallContext context)
    {
        if (!Guid.TryParse(request.ParentTaskId, out var parentTaskId) ||
            !Guid.TryParse(request.SubtaskId, out var subtaskId))
        {
            throw new RpcException(new global::Grpc.Core.Status(
                global::Grpc.Core.StatusCode.InvalidArgument, "parent_task_id and subtask_id must be valid GUIDs"));
        }

        var subtask = await _todoRepository.GetByIdAsync(subtaskId, context.CancellationToken);

        // Exists only as a valid reply target: a live child of exactly this parent task.
        if (subtask is null || subtask.ParentTodoId != parentTaskId)
        {
            return new GetSubtaskBriefResponse { Exists = false, Title = string.Empty, AuthorId = string.Empty };
        }

        return new GetSubtaskBriefResponse
        {
            Exists = true,
            Title = subtask.Title,
            AuthorId = subtask.UserId.ToString(),
        };
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
