namespace Planora.Auth.Application.Features.Users.Queries.GetUserSessions
{
    public sealed record GetUserSessionsQuery : IQuery<Result<List<SessionDto>>>;
}
