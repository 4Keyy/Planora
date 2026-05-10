namespace Planora.Auth.Application.Features.Users.Commands.UpdateUser
{
    public sealed record UpdateUserCommand : ICommand<Result<UserDto>>
    {
        public string FirstName { get; init; } = string.Empty;
        public string LastName { get; init; } = string.Empty;
        public string? ProfilePictureUrl { get; init; }
    }
}
