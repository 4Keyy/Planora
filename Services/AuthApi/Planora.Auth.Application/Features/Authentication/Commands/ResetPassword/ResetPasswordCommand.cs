namespace Planora.Auth.Application.Features.Authentication.Commands.ResetPassword
{
    public sealed record ResetPasswordCommand : ICommand<Result>
    {
        public string ResetToken { get; init; } = string.Empty;
        public string NewPassword { get; init; } = string.Empty;
        public string ConfirmPassword { get; init; } = string.Empty;
    }
}
