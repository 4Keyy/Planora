using Planora.BuildingBlocks.Application.CQRS;
using Planora.BuildingBlocks.Application.Pagination;
using Planora.BuildingBlocks.Domain;
using Planora.Collaboration.Application.DTOs;

namespace Planora.Collaboration.Application.Features.Comments.Queries.GetComments
{
    public sealed record GetCommentsQuery(
        Guid TaskId,
        int PageNumber = 1,
        int PageSize = 50) : IQuery<Result<PagedResult<CommentDto>>>;
}
