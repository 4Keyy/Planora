namespace Planora.Auth.Application.Features.Users.Commands.Disable2FA
{
    public sealed record Disable2FACommand : ICommand<Result>
    {
        public string Password { get; init; } = string.Empty;
    }
}
