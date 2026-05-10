namespace Planora.Auth.Application.Features.Users.Commands.DeleteUser
{
    public sealed record DeleteUserCommand : ICommand<Result>
    {
        public string Password { get; init; } = string.Empty;
    }
}
