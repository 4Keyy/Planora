namespace Planora.Auth.Application.Features.Users.Queries.GetUser
{
    public sealed record GetUserQuery : IQuery<Result<UserDetailDto>>
    {
        public Guid UserId { get; init; }

        public GetUserQuery(Guid userId)
        {
            UserId = userId;
        }
    }
}
