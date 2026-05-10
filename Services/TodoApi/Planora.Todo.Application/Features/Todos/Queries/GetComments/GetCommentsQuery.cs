using Planora.BuildingBlocks.Application.CQRS;
using Planora.BuildingBlocks.Application.Pagination;
using Planora.BuildingBlocks.Domain;
using Planora.Todo.Application.DTOs;

namespace Planora.Todo.Application.Features.Todos.Queries.GetComments
{
    public sealed record GetCommentsQuery(
        Guid TodoId,
        int PageNumber = 1,
        int PageSize = 50) : IQuery<Result<PagedResult<TodoCommentDto>>>;
}
