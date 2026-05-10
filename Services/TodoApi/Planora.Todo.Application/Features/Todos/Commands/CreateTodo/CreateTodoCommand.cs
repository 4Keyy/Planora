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
        IReadOnlyList<Guid>? SharedWithUserIds = null) : ICommand<Result<TodoItemDto>>;
}
