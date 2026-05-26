namespace Planora.Auth.Application.Common.Interfaces;

public interface IImageProcessor
{
    Task<Planora.BuildingBlocks.Domain.Result<ProcessedImage>> ProcessAvatarAsync(
        Stream source,
        long sourceLength,
        CancellationToken cancellationToken = default);
}

public sealed record ProcessedImage(
    byte[] Data,
    string ContentType,
    string Extension,
    int Width,
    int Height);
