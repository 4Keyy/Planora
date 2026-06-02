using Planora.BuildingBlocks.Domain;
using Planora.Todo.Application.DTOs;

namespace Planora.Todo.Application.Features.Todos.Queries.GetSubtasks
{
    /// <summary>
    /// Returns the subtasks of a task, oldest first. The caller must be able to see the parent
    /// (owner, or a friend for a shared/public parent). Used only by the task's branch view.
    /// </summary>
    public sealed record GetSubtasksQuery(Guid ParentTodoId) : IQuery<Result<IReadOnlyList<TodoItemDto>>>;
}
