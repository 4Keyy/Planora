namespace Planora.Auth.Application.Common.Interfaces;

public interface IImageProcessor
{
    Task<Planora.BuildingBlocks.Domain.Result<ProcessedAvatar>> ProcessAvatarAsync(
        Stream source,
        long sourceLength,
        CancellationToken cancellationToken = default);
}

public sealed record ProcessedAvatar(
    string ContentHash,
    IReadOnlyList<AvatarVariant> Variants);

public sealed record AvatarVariant(
    AvatarSize Size,
    byte[] Data,
    string ContentType,
    string Extension,
    int Width,
    int Height);

public enum AvatarSize
{
    Small = 64,
    Medium = 128,
    Large = 512,
}
