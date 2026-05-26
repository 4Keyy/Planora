using Planora.Auth.Application.Common.Interfaces;
using Planora.Auth.Application.Features.Users.Validators.UploadAvatar;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Webp;
using Error = Planora.BuildingBlocks.Domain.Error;
using Result = Planora.BuildingBlocks.Domain.Result;

namespace Planora.Auth.Infrastructure.Services.Common;

public sealed class ImageSharpImageProcessor : IImageProcessor
{
    private static readonly byte[] JpegMagic = { 0xFF, 0xD8, 0xFF };
    private static readonly byte[] PngMagic = { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A };
    private static readonly byte[] WebpRiff = { 0x52, 0x49, 0x46, 0x46 };
    private static readonly byte[] WebpFourCc = { 0x57, 0x45, 0x42, 0x50 };

    private readonly ILogger<ImageSharpImageProcessor> _logger;

    public ImageSharpImageProcessor(ILogger<ImageSharpImageProcessor> logger)
    {
        _logger = logger;
    }

    public async Task<Planora.BuildingBlocks.Domain.Result<ProcessedImage>> ProcessAvatarAsync(
        Stream source,
        long sourceLength,
        CancellationToken cancellationToken = default)
    {
        if (sourceLength > UploadAvatarCommandValidator.MaxFileSizeBytes)
        {
            return Planora.BuildingBlocks.Domain.Result<ProcessedImage>.Failure(
                Error.Validation("INVALID_FILE_SIZE", "File exceeds the 5 MB limit"));
        }

        // Buffer into memory so magic-byte sniffing and ImageSharp decoder can both read.
        // Capacity-bounded by validator (5 MB max).
        await using var buffer = new MemoryStream(capacity: (int)Math.Min(sourceLength, UploadAvatarCommandValidator.MaxFileSizeBytes));
        await source.CopyToAsync(buffer, cancellationToken);
        var bytes = buffer.ToArray();

        if (!HasAllowedMagicBytes(bytes))
        {
            return Planora.BuildingBlocks.Domain.Result<ProcessedImage>.Failure(
                Error.Validation("UNSUPPORTED_MEDIA_TYPE", "File does not match JPEG/PNG/WEBP signature"));
        }

        try
        {
            using var image = await Image.LoadAsync(new MemoryStream(bytes), cancellationToken);

            if (image.Width < UploadAvatarCommandValidator.MinDimension
                || image.Height < UploadAvatarCommandValidator.MinDimension)
            {
                return Planora.BuildingBlocks.Domain.Result<ProcessedImage>.Failure(
                    Error.Validation("INVALID_IMAGE_CONTENT",
                        $"Image must be at least {UploadAvatarCommandValidator.MinDimension}x{UploadAvatarCommandValidator.MinDimension}"));
            }

            if (image.Width > UploadAvatarCommandValidator.MaxDimension
                || image.Height > UploadAvatarCommandValidator.MaxDimension)
            {
                return Planora.BuildingBlocks.Domain.Result<ProcessedImage>.Failure(
                    Error.Validation("INVALID_IMAGE_CONTENT",
                        $"Image must not exceed {UploadAvatarCommandValidator.MaxDimension}x{UploadAvatarCommandValidator.MaxDimension}"));
            }

            // Strip EXIF/ICC/XMP — re-encoding to WebP produces a brand-new bytestream
            // and we explicitly clear metadata to be safe.
            image.Metadata.ExifProfile = null;
            image.Metadata.IccProfile = null;
            image.Metadata.XmpProfile = null;

            await using var output = new MemoryStream();
            await image.SaveAsWebpAsync(output, new WebpEncoder
            {
                Quality = 85,
                FileFormat = WebpFileFormatType.Lossy,
            }, cancellationToken);

            return Planora.BuildingBlocks.Domain.Result<ProcessedImage>.Success(new ProcessedImage(
                Data: output.ToArray(),
                ContentType: "image/webp",
                Extension: ".webp",
                Width: image.Width,
                Height: image.Height));
        }
        catch (UnknownImageFormatException)
        {
            return Planora.BuildingBlocks.Domain.Result<ProcessedImage>.Failure(
                Error.Validation("INVALID_IMAGE_CONTENT", "File is not a valid image"));
        }
        catch (InvalidImageContentException ex)
        {
            _logger.LogWarning(ex, "Invalid image content rejected");
            return Planora.BuildingBlocks.Domain.Result<ProcessedImage>.Failure(
                Error.Validation("INVALID_IMAGE_CONTENT", "File is not a valid image"));
        }
    }

    private static bool HasAllowedMagicBytes(byte[] bytes)
    {
        if (StartsWith(bytes, JpegMagic)) return true;
        if (StartsWith(bytes, PngMagic)) return true;
        if (bytes.Length >= 12
            && StartsWith(bytes, WebpRiff)
            && bytes[8] == WebpFourCc[0]
            && bytes[9] == WebpFourCc[1]
            && bytes[10] == WebpFourCc[2]
            && bytes[11] == WebpFourCc[3])
        {
            return true;
        }
        return false;
    }

    private static bool StartsWith(byte[] data, byte[] prefix)
    {
        if (data.Length < prefix.Length) return false;
        for (var i = 0; i < prefix.Length; i++)
        {
            if (data[i] != prefix[i]) return false;
        }
        return true;
    }
}
