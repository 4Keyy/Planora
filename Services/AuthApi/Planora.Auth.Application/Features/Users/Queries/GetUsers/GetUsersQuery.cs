using Planora.BuildingBlocks.Application.Pagination;

namespace Planora.Auth.Application.Features.Users.Queries.GetUsers
{
    public sealed record GetUsersQuery : PaginationQuery, IQuery<Result<PagedResult<UserListDto>>>
    {
        public string? Status { get; init; }
        public DateTime? CreatedFrom { get; init; }
        public DateTime? CreatedTo { get; init; }
    }
}
