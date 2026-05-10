using Planora.BuildingBlocks.Application.Pagination;
using Planora.BuildingBlocks.Domain;
using Planora.Todo.Application.DTOs;

namespace Planora.Todo.Application.Features.Todos.Queries.GetPublicTodos
{
    public sealed record GetPublicTodosQuery(
        int PageNumber = 1,
        int PageSize = 10,
        Guid? FriendId = null) : IQuery<Result<PagedResult<TodoItemDto>>>;
}

