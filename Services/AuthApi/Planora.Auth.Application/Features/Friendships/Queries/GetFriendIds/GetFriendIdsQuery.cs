using Planora.BuildingBlocks.Application.Models;
using MediatR;

namespace Planora.Auth.Application.Features.Friendships.Queries.GetFriendIds
{
    public sealed record GetFriendIdsQuery(Guid UserId) : IQuery<Result<List<Guid>>>;
}