namespace Planora.Auth.Application.Features.Users.Queries.GetUserAvatarsByIds
{
    /// <summary>
    /// Returns a mapping of userId -> profilePictureUrl for the requested user IDs.
    /// Empty or null profilePictureUrl values are omitted from the result.
    /// </summary>
    public sealed record GetUserAvatarsByIdsQuery(IReadOnlyList<Guid> UserIds)
        : IQuery<Result<IReadOnlyDictionary<Guid, string>>>;
}
