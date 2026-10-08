using System.Security.Cryptography;
using Planora.Auth.Application.Common.Interfaces;
using Planora.Auth.Application.Features.Users.Validators.UploadAvatar;
using Planora.BuildingBlocks.Domain;
using SkiaSharp;

namespace Planora.Auth.Infrastructure.Services.Common;

public sealed class SkiaImageProcessor : IImageProcessor
{
    private static readonly AvatarSize[] TargetSizes = [AvatarSize.Small, AvatarSize.Medium, AvatarSize.Large];

    public async Task<Result<ProcessedAvatar>> ProcessAvatarAsync(
        Stream source, long sourceLength, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(source);
        cancellationToken.ThrowIfCancellationRequested();
        const long maxBytes = UploadAvatarCommandValidator.MaxFileSizeBytes;
        if (sourceLength < 0 || sourceLength > maxBytes)
            return InvalidSize();

        // The caller's declared length is only a hint: bound actual reads before decoding.
        using var buffer = new MemoryStream((int)Math.Min(sourceLength, maxBytes));
        var chunk = new byte[64 * 1024];
        while (true)
        {
            var read = await source.ReadAsync(chunk.AsMemory(0, (int)Math.Min(chunk.Length, maxBytes - buffer.Length + 1)), cancellationToken);
            if (read == 0) break;
            if (buffer.Length + read > maxBytes) return InvalidSize();
            buffer.Write(chunk, 0, read);
        }
        var bytes = buffer.ToArray();
        if (!HasAllowedSignature(bytes))
            return Result<ProcessedAvatar>.Failure(Error.Validation("UNSUPPORTED_MEDIA_TYPE", "File does not match JPEG/PNG/WEBP signature"));

        using var encoded = SKData.CreateCopy(bytes);
        using var codec = SKCodec.Create(encoded);
        if (codec is null || codec.EncodedFormat is not (SKEncodedImageFormat.Jpeg or SKEncodedImageFormat.Png or SKEncodedImageFormat.Webp))
            return InvalidImage();
        // Read dimensions before allocating the decoded bitmap; never allocate from unbounded input.
        var width = codec.Info.Width;
        var height = codec.Info.Height;
        if (width < UploadAvatarCommandValidator.MinDimension || height < UploadAvatarCommandValidator.MinDimension
            || width > UploadAvatarCommandValidator.MaxDimension || height > UploadAvatarCommandValidator.MaxDimension)
            return InvalidImage();

        cancellationToken.ThrowIfCancellationRequested();
        using var bitmap = new SKBitmap(new SKImageInfo(width, height, SKColorType.Rgba8888, SKAlphaType.Premul));
        if (codec.GetPixels(bitmap.Info, bitmap.GetPixels()) != SKCodecResult.Success) return InvalidImage();
        using var image = SKImage.FromBitmap(bitmap);
        var edge = Math.Min(width, height);
        var crop = SKRect.Create((width - edge) / 2f, (height - edge) / 2f, edge, edge);
        var variants = new List<AvatarVariant>(TargetSizes.Length);
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        foreach (var size in TargetSizes)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var pixels = (int)size;
            // A fresh pixel surface carries no EXIF, ICC or XMP from the uploaded file.
            using var surface = SKSurface.Create(new SKImageInfo(pixels, pixels, SKColorType.Rgba8888, SKAlphaType.Premul));
            surface.Canvas.DrawImage(image, crop, SKRect.Create(pixels, pixels), new SKSamplingOptions(SKCubicResampler.Mitchell));
            using var resized = surface.Snapshot();
            using var output = resized.Encode(SKEncodedImageFormat.Webp, 85);
            if (output is null) return InvalidImage();
            var data = output.ToArray();
            hash.AppendData(data);
            variants.Add(new AvatarVariant(size, data, "image/webp", ".webp", pixels, pixels));
        }
        cancellationToken.ThrowIfCancellationRequested();
        return Result<ProcessedAvatar>.Success(new ProcessedAvatar(Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant()[..16], variants));
    }

    private static Result<ProcessedAvatar> InvalidSize() =>
        Result<ProcessedAvatar>.Failure(Error.Validation("INVALID_FILE_SIZE", "File exceeds the 5 MB limit or has an invalid length"));
    private static Result<ProcessedAvatar> InvalidImage() =>
        Result<ProcessedAvatar>.Failure(Error.Validation("INVALID_IMAGE_CONTENT", "File is not a valid image within the allowed dimensions"));
    private static bool HasAllowedSignature(ReadOnlySpan<byte> bytes) =>
        bytes.StartsWith(new byte[] { 0xff, 0xd8, 0xff })
        || bytes.StartsWith(new byte[] { 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a })
        || (bytes.Length >= 12 && bytes[..4].SequenceEqual("RIFF"u8) && bytes.Slice(8, 4).SequenceEqual("WEBP"u8));
}
