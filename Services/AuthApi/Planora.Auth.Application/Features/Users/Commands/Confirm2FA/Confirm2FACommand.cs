namespace Planora.Auth.Application.Features.Users.Commands.Confirm2FA
{
    public sealed record Confirm2FACommand : ICommand<Result>
    {
        public string Code { get; init; } = string.Empty;
    }
}
