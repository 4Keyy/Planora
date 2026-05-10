using Planora.BuildingBlocks.Application.Pagination;
using Planora.BuildingBlocks.Domain;
using Planora.Todo.Application.DTOs;

namespace Planora.Todo.Application.Features.Todos.Queries.GetTodosByCategory
{
    public sealed record GetTodosByCategoryQuery(
        Guid CategoryId,
        Guid? UserId,
        int PageNumber = 1,
        int PageSize = 10) : IQuery<Result<PagedResult<TodoItemDto>>>;
}
