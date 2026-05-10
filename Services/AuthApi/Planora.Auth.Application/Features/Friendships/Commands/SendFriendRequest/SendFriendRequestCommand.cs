using Planora.BuildingBlocks.Application.Models;

namespace Planora.Auth.Application.Features.Friendships.Commands.SendFriendRequest
{
    public sealed record SendFriendRequestCommand(Guid FriendId) : ICommand<Result>;
}

