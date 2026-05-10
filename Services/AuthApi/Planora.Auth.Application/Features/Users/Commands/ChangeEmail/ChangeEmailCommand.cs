namespace Planora.Auth.Application.Features.Users.Commands.ChangeEmail
{
    public sealed record ChangeEmailCommand : ICommand<Result>
    {
        public string NewEmail { get; init; } = string.Empty;
        public string Password { get; init; } = string.Empty;
    }
}
