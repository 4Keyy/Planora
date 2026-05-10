namespace Planora.Auth.Application.Features.Users.Commands.Enable2FA
{
    public sealed record Enable2FACommand : ICommand<Result<Enable2FAResponse>>
    {
    }

    public sealed record Enable2FAResponse
    {
        public string Secret { get; init; } = string.Empty;
        public string QrCodeUrl { get; init; } = string.Empty;
    }
}
