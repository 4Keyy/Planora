using Planora.BuildingBlocks.Application.Models;

namespace Planora.Auth.Application.Features.Friendships.Commands.RemoveFriend
{
    public sealed record RemoveFriendCommand(Guid FriendId) : ICommand<Result>;
}

