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
        bool? IsCompleted = null) : IQuery<PagedResult<TodoItemDto>>;
}
