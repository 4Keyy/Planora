namespace Planora.Auth.Application.Features.Users.Queries.GetCurrentUser
{
    public sealed record GetCurrentUserQuery : IQuery<Result<UserDto>>;
}
