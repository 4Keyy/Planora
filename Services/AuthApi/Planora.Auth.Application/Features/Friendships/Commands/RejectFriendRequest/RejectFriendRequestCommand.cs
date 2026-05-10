using Planora.BuildingBlocks.Application.Models;

namespace Planora.Auth.Application.Features.Friendships.Commands.RejectFriendRequest
{
    public sealed record RejectFriendRequestCommand(Guid FriendshipId) : ICommand<Result>;
}

