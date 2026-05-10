namespace Planora.Auth.Application.Features.Users.Commands.ChangePassword
{
    public sealed record ChangePasswordCommand : ICommand<Result>
    {
        public string CurrentPassword { get; init; } = string.Empty;
        public string NewPassword { get; init; } = string.Empty;
        public string ConfirmNewPassword { get; init; } = string.Empty;
    }
}
