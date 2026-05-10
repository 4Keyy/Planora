namespace Planora.Auth.Application.Features.Users.Commands.VerifyEmail
{
    public sealed record VerifyEmailCommand : ICommand<Result>
    {
        public string Token { get; init; } = string.Empty;
    }
}
