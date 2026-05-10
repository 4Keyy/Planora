using Planora.BuildingBlocks.Application.Pagination;

namespace Planora.Auth.Application.Features.Users.Queries.GetLoginHistory
{
    public sealed record GetLoginHistoryQuery : PaginationQuery, IQuery<Result<PagedResult<LoginHistoryPagedDto>>>;
}
