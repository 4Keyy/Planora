namespace Planora.Todo.Application.Services
{
    /// <summary>
    /// A user's live display identity as owned by the Auth service ("" / null when unknown).
    /// </summary>
    public sealed record UserProfileInfo(string DisplayName, string? AvatarUrl);

    /// <summary>
    /// Resolves live user profiles (display name + avatar) from the Auth service. Used to
    /// enrich subtask DTOs with their author's identity so the branch card can show
    /// "who added this step" without storing a name copy that would go stale after a rename.
    /// Implementations are failure-tolerant: enrichment is cosmetic, so a lookup failure
    /// yields an empty result instead of failing the read.
    /// </summary>
    public interface IUserProfileService
    {
        Task<IReadOnlyDictionary<Guid, UserProfileInfo>> GetProfilesAsync(
            IEnumerable<Guid> userIds,
            CancellationToken cancellationToken = default);
    }
}
