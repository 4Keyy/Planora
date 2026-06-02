using Planora.BuildingBlocks.Application.Pagination;
using Planora.Todo.Application.DTOs;

namespace Planora.Todo.Application.Features.Todos.Queries.GetUserTodos
{
    public sealed record GetUserTodosQuery(
        Guid? UserId,
        int PageNumber = 1,
        int PageSize = 10,
        string? Status = null,
        Guid? CategoryId = null,
        bool? IsCompleted = null,
        // Subtasks are hidden from every task list by default. The dashboard stats fetch opts in
        // (IncludeSubtasks = true) so completed subtasks still count toward weekly statistics —
        // the client filters them out of the displayed grid by ParentTodoId.
        bool IncludeSubtasks = false) : IQuery<PagedResult<TodoItemDto>>;
}
