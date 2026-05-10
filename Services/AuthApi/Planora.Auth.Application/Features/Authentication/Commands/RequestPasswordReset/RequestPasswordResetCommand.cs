namespace Planora.Auth.Application.Features.Authentication.Commands.RequestPasswordReset
{
    public sealed record RequestPasswordResetCommand : ICommand<Result>
    {
        public string Email { get; init; } = string.Empty;
    }
}
