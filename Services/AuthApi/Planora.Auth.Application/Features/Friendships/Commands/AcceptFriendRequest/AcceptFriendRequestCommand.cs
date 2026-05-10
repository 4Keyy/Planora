using Planora.BuildingBlocks.Application.Models;

namespace Planora.Auth.Application.Features.Friendships.Commands.AcceptFriendRequest
{
    public sealed record AcceptFriendRequestCommand(Guid FriendshipId) : ICommand<Result>;
}

