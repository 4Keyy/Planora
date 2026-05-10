namespace Planora.Auth.Application.Features.Authentication.Commands.Logout
{
    public sealed record LogoutCommand : ICommand<Result>
    {
        public string? RefreshToken { get; init; }
    }
}
