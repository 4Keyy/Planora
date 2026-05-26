using System.Security.Cryptography;
using Planora.Auth.Application.Common.Interfaces;
using Planora.Auth.Application.Features.Users.Validators.UploadAvatar;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Webp;
using SixLabors.ImageSharp.PixelFormats;
using SixLabors.ImageSharp.Processing;
using Error = Planora.BuildingBlocks.Domain.Error;

namespace Planora.Auth.Infrastructure.Services.Common;

public sealed class ImageSharpImageProcessor : IImageProcessor
{
    private static readonly byte[] JpegMagic = { 0xFF, 0xD8, 0xFF };
    private static readonly byte[] PngMagic = { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A };
    private static readonly byte[] WebpRiff = { 0x52, 0x49, 0x46, 0x46 };
    private static readonly byte[] WebpFourCc = { 0x57, 0x45, 0x42, 0x50 };

    private static readonly AvatarSize[] TargetSizes =
    {
        AvatarSize.Small,
        AvatarSize.Medium,
        AvatarSize.Large,
    };

    private readonly ILogger<ImageSharpImageProcessor> _logger;

    public ImageSharpImageProcessor(ILogger<ImageSharpImageProcessor> logger)
    {
        _logger = logger;
    }

    public async Task<Planora.BuildingBlocks.Domain.Result<ProcessedAvatar>> ProcessAvatarAsync(
        Stream source,
        long sourceLength,
        CancellationToken cancellationToken = default)
    {
        if (sourceLength > UploadAvatarCommandValidator.MaxFileSizeBytes)
        {
            return Planora.BuildingBlocks.Domain.Result<ProcessedAvatar>.Failure(
                Error.Validation("INVALID_FILE_SIZE", "File exceeds the 5 MB limit"));
        }

        await using var buffer = new MemoryStream(capacity: (int)Math.Min(sourceLength, UploadAvatarCommandValidator.MaxFileSizeBytes));
        await source.CopyToAsync(buffer, cancellationToken);
        var bytes = buffer.ToArray();

        if (!HasAllowedMagicBytes(bytes))
        {
            return Planora.BuildingBlocks.Domain.Result<ProcessedAvatar>.Failure(
                Error.Validation("UNSUPPORTED_MEDIA_TYPE", "File does not match JPEG/PNG/WEBP signature"));
        }

        try
        {
            using var image = await Image.LoadAsync<Rgba32>(new MemoryStream(bytes), cancellationToken);

            if (image.Width < UploadAvatarCommandValidator.MinDimension
                || image.Height < UploadAvatarCommandValidator.MinDimension)
            {
                return Planora.BuildingBlocks.Domain.Result<ProcessedAvatar>.Failure(
                    Error.Validation("INVALID_IMAGE_CONTENT",
                        $"Image must be at least {UploadAvatarCommandValidator.MinDimension}x{UploadAvatarCommandValidator.MinDimension}"));
            }

            if (image.Width > UploadAvatarCommandValidator.MaxDimension
                || image.Height > UploadAvatarCommandValidator.MaxDimension)
            {
                return Planora.BuildingBlocks.Domain.Result<ProcessedAvatar>.Failure(
                    Error.Validation("INVALID_IMAGE_CONTENT",
                        $"Image must not exceed {UploadAvatarCommandValidator.MaxDimension}x{UploadAvatarCommandValidator.MaxDimension}"));
            }

            image.Metadata.ExifProfile = null;
            image.Metadata.IccProfile = null;
            image.Metadata.XmpProfile = null;

            var encoder = new WebpEncoder
            {
                Quality = 85,
                FileFormat = WebpFileFormatType.Lossy,
            };

            var variants = new List<AvatarVariant>(TargetSizes.Length);
            using (var hasher = SHA256.Create())
            {
                foreach (var size in TargetSizes)
                {
                    var pixels = (int)size;
                    using var variant = image.Clone(ctx => ctx.Resize(new ResizeOptions
                    {
                        Size = new Size(pixels, pixels),
                        Mode = ResizeMode.Crop,
                        Position = AnchorPositionMode.Center,
                        Sampler = KnownResamplers.Lanczos3,
                    }));

                    await using var output = new MemoryStream();
                    await variant.SaveAsWebpAsync(output, encoder, cancellationToken);
                    var data = output.ToArray();

                    hasher.TransformBlock(data, 0, data.Length, null, 0);

                    variants.Add(new AvatarVariant(
                        Size: size,
                        Data: data,
                        ContentType: "image/webp",
                        Extension: ".webp",
                        Width: variant.Width,
                        Height: variant.Height));
                }
                hasher.TransformFinalBlock(Array.Empty<byte>(), 0, 0);
                var hash = Convert.ToHexString(hasher.Hash!).ToLowerInvariant()[..16];

                return Planora.BuildingBlocks.Domain.Result<ProcessedAvatar>.Success(
                    new ProcessedAvatar(ContentHash: hash, Variants: variants));
            }
        }
        catch (UnknownImageFormatException)
        {
            return Planora.BuildingBlocks.Domain.Result<ProcessedAvatar>.Failure(
                Error.Validation("INVALID_IMAGE_CONTENT", "File is not a valid image"));
        }
        catch (InvalidImageContentException ex)
        {
            _logger.LogWarning(ex, "Invalid image content rejected");
            return Planora.BuildingBlocks.Domain.Result<ProcessedAvatar>.Failure(
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
