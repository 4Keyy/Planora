using Planora.Auth.Application.Common.DTOs;
using Planora.BuildingBlocks.Domain;
using Planora.BuildingBlocks.Application.CQRS;
using Microsoft.AspNetCore.Http;

namespace Planora.Auth.Application.Features.Users.Commands.UploadAvatar
{
    public sealed record UploadAvatarCommand : ICommand<Planora.BuildingBlocks.Domain.Result<UserDto>>
    {
        public IFormFile File { get; init; } = null!;
    }
}
