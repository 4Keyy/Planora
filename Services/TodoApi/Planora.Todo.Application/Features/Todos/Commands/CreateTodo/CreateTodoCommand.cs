using Planora.BuildingBlocks.Domain;
using Planora.Todo.Application.DTOs;
using Planora.Todo.Domain.Enums;

namespace Planora.Todo.Application.Features.Todos.Commands.CreateTodo
{
    public sealed record CreateTodoCommand(
        Guid? UserId,
        string Title,
        string? Description,
        Guid? CategoryId,
        DateTime? DueDate,
        DateTime? ExpectedDate,
        TodoPriority Priority = TodoPriority.Medium,
        bool IsPublic = false,
        IReadOnlyList<Guid>? SharedWithUserIds = null,
        int? RequiredWorkers = null,
        // Optional START of the estimated-completion interval. When set, DueDate is its END bound.
        // Null means a single target date (DueDate) or no date at all.
        DateTime? DueDateStart = null) : ICommand<Result<TodoItemDto>>;
}
