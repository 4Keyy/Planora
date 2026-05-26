namespace Planora.Auth.Application.Common.Interfaces;

public interface IAvatarStorage
{
    Task<AvatarManifest> PutAsync(
        Guid userId,
        ProcessedAvatar avatar,
        CancellationToken cancellationToken = default);

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
