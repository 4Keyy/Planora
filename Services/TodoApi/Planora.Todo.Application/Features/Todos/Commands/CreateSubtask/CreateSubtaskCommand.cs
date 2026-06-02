using Planora.BuildingBlocks.Domain;
using Planora.Todo.Application.DTOs;
using Planora.Todo.Domain.Enums;

namespace Planora.Todo.Application.Features.Todos.Commands.CreateSubtask
{
    /// <summary>
    /// Creates a subtask under a parent task. The subtask inherits the parent's category,
    /// public flag and shared audience; it carries its own title, optional description and
    /// priority, and never a due/expected date. Owner-only.
    /// </summary>
    public sealed record CreateSubtaskCommand(
        Guid ParentTodoId,
        string Title,
        string? Description = null,
        TodoPriority Priority = TodoPriority.Medium) : ICommand<Result<TodoItemDto>>;
}
