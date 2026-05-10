using Planora.BuildingBlocks.Application.Models;

namespace Planora.Auth.Application.Features.Friendships.Commands.SendFriendRequestByEmail;

public sealed record SendFriendRequestByEmailCommand(string Email) : ICommand<Result>;
