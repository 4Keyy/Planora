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
        string? Status = null,
        int? RequiredWorkers = null,
        bool ClearRequiredWorkers = false,
        // START of the estimated-completion interval (END is DueDate). Null = single target date.
        DateTime? DueDateStart = null,
        // Explicitly clears the due date/interval. Required because a plain null DueDate is
        // indistinguishable from "unchanged" on the full-payload autosave path — mirrors
        // ClearRequiredWorkers. When true, DueDate/DueDateStart are both wiped.
        bool ClearDueDate = false) : ICommand<Result<TodoItemDto>>;
}
