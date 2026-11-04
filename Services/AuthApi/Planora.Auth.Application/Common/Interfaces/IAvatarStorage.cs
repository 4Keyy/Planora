namespace Planora.Auth.Application.Common.Interfaces;

public interface IAvatarStorage
{
    /// <summary>Serializes a user's upload through profile persistence and revision cleanup.</summary>
    Task<IAsyncDisposable> AcquireMutationLockAsync(Guid userId, CancellationToken cancellationToken = default);

    Task<AvatarManifest> PutAsync(
        Guid userId,
        ProcessedAvatar avatar,
        CancellationToken cancellationToken = default);

    void PruneOldRevisions(Guid userId, string keepHash);

    Task DeleteAsync(Guid userId, CancellationToken cancellationToken = default);
}

public sealed record AvatarManifest(
    string SmallUrl,
    string MediumUrl,
    string LargeUrl,
    string ContentHash)
{
    /// <summary>
    /// Canonical URL persisted on User.ProfilePictureUrl. Clients derive other variants
    /// by swapping the size segment (64.webp / 128.webp / 512.webp).
    /// </summary>
    public string CanonicalUrl => MediumUrl;
}
