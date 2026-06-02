namespace Planora.Collaboration.Application.Services
{
    /// <summary>
    /// A user's live identity as owned by the Auth service. Resolved on read so the timeline
    /// always shows the current name + avatar — Collaboration never stores its own copy of the
    /// name (which would go stale after a profile rename).
    /// </summary>
    public sealed record UserProfile(string DisplayName, string? AvatarUrl);

    /// <summary>
    /// Provides current user identity (display name + avatar) from the Auth service, used to
    /// resolve comment authors live. Replaces the former avatar-only contract so the author name
    /// is never a stored copy.
    /// </summary>
    public interface IUserService
    {
        /// <summary>
        /// Returns the live profile (display name + avatar) for the given user IDs.
        /// Users that do not exist are omitted. Failures are swallowed — the caller should
        /// treat missing entries as "unknown user" and fall back accordingly.
        /// </summary>
        Task<IReadOnlyDictionary<Guid, UserProfile>> GetUserProfilesAsync(
            IEnumerable<Guid> userIds,
            CancellationToken cancellationToken = default);
    }
}
