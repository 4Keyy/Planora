using Planora.BuildingBlocks.Domain;
using Planora.Todo.Application.DTOs;

namespace Planora.Todo.Application.Features.Todos.Commands.DuplicateTodo
{
    /// <summary>
    /// Duplicates an existing task into a brand-new active task owned by the caller. Copies the
    /// "what" of the task — title, description, priority, category, visibility, shared audience,
    /// tags, required workers — but deliberately NOT its dates, its completion state, or its branch
    /// (comments / subtasks). The copy is authored server-side and emits the same creation events a
    /// normal create does, so notifications and the new branch's "created" system comment all fire.
    /// </summary>
    public sealed record DuplicateTodoCommand(Guid SourceTodoId) : ICommand<Result<TodoItemDto>>;
}
