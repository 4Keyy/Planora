using Planora.BuildingBlocks.Application.Models;

namespace Planora.Auth.Application.Features.Friendships.Queries.GetFriendRequests
{
    public sealed record GetFriendRequestsQuery(bool Incoming = true) : IQuery<Result<IReadOnlyList<FriendRequestDto>>>;
}

