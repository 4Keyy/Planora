namespace Planora.Auth.Application.Features.Users.Commands.RevokeSession
{
    public sealed record RevokeSessionCommand : ICommand<Result>
    {
        public Guid TokenId { get; init; }
    }
}
