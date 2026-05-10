using Planora.BuildingBlocks.Domain;
using Planora.Todo.Application.DTOs;
using Planora.Todo.Domain.Enums;

namespace Planora.Todo.Application.Features.Todos.Commands.UpdateTodo
{
    public sealed record UpdateTodoCommand(
        Guid TodoId,
        string? Title = null,
        string? Description = null,
        Guid? CategoryId = null,
        DateTime? DueDate = null,
        DateTime? ExpectedDate = null,
        DateTime? ActualDate = null,
        TodoPriority? Priority = null,
        bool? IsPublic = null,
        IReadOnlyList<Guid>? SharedWithUserIds = null,
        string? Status = null) : ICommand<Result<TodoItemDto>>;
}
