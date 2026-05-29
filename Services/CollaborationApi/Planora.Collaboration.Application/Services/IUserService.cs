namespace Planora.Collaboration.Application.Services
{
    /// <summary>
    /// Provides current user profile data from the Auth service. Used to enrich comment author
    /// avatars. Ported from the former TodoApi.IUserService — identical contract.
    /// </summary>
    public interface IUserService
    {
        /// <summary>
        /// Returns the current profile picture URLs for the given user IDs.
        /// Users without a profile picture are omitted from the result.
        /// Failures are swallowed — the caller should treat missing entries as "no avatar".
        /// </summary>
        Task<IReadOnlyDictionary<Guid, string>> GetUserAvatarsAsync(
            IEnumerable<Guid> userIds,
            CancellationToken cancellationToken = default);
    }
}
