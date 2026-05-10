namespace Planora.Auth.Application.Features.Users.Commands.RevokeAllSessions
{
    public sealed record RevokeAllSessionsCommand : ICommand<Result>
    {
        public string Password { get; init; } = string.Empty;
    }
}
