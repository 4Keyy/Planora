using Planora.BuildingBlocks.Application.Models;
using MediatR;

namespace Planora.Auth.Application.Features.Friendships.Queries.AreFriends
{
    public sealed record AreFriendsQuery(Guid UserId1, Guid UserId2) : IQuery<Result<bool>>;
}