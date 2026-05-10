using Planora.BuildingBlocks.Application.Models;
using Planora.BuildingBlocks.Application.Pagination;

namespace Planora.Auth.Application.Features.Friendships.Queries.GetFriends
{
    public sealed record GetFriendsQuery(
        int PageNumber = 1,
        int PageSize = 10) : IQuery<Result<PagedResult<FriendDto>>>;
}

