using Planora.Auth.Application.Features.Authentication.Response.Login;

namespace Planora.Auth.Application.Features.Authentication.Commands.Login
{
    public sealed record LoginCommand : ICommand<BuildingBlocks.Domain.Result<LoginResponse>>
    {
        public string Email { get; init; } = string.Empty;
        public string Password { get; init; } = string.Empty;
        public bool RememberMe { get; init; }
        public string? TwoFactorCode { get; init; }
    }
}
