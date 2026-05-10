using Planora.Auth.Application.Features.Authentication.Response.Register;

namespace Planora.Auth.Application.Features.Authentication.Commands.Register
{
    public sealed record RegisterCommand : ICommand<BuildingBlocks.Domain.Result<RegisterResponse>>
    {
        public string Email { get; init; } = string.Empty;
        public string Password { get; init; } = string.Empty;
        public string ConfirmPassword { get; init; } = string.Empty;
        public string FirstName { get; init; } = string.Empty;
        public string LastName { get; init; } = string.Empty;
    }
}
