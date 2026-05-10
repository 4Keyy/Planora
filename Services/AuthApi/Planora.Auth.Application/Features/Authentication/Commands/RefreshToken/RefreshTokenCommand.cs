namespace Planora.Auth.Application.Features.Authentication.Commands.RefreshToken
{
    public sealed record RefreshTokenCommand : ICommand<Result<TokenDto>>
    {
        public string RefreshToken { get; init; } = string.Empty;
    }
}
