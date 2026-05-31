namespace Planora.Auth.Application.Features.Users.Queries.GetUserProfilesByIds
{
    /// <summary>
    /// Lightweight identity summary for a user: the display name plus avatar URL.
    /// Lets other services resolve author identity LIVE instead of storing a copy
    /// of the name that goes stale after a profile rename.
    /// </summary>
    public sealed record UserProfileSummaryDto(string DisplayName, string? AvatarUrl);

    /// <summary>
    /// Returns a mapping of userId -> profile summary (display name + avatar) for the
    /// requested user IDs. Users that do not exist are omitted from the result.
    /// </summary>
    public sealed record GetUserProfilesByIdsQuery(IReadOnlyList<Guid> UserIds)
        : IQuery<Result<IReadOnlyDictionary<Guid, UserProfileSummaryDto>>>;
}
