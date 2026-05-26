using Planora.Auth.Application.Common.Interfaces;
using Planora.Auth.Infrastructure.Services.Common;
using Microsoft.Extensions.Logging.Abstractions;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Jpeg;
using SixLabors.ImageSharp.Formats.Png;
using SixLabors.ImageSharp.Formats.Webp;
using SixLabors.ImageSharp.Metadata.Profiles.Exif;
using SixLabors.ImageSharp.PixelFormats;

namespace Planora.UnitTests.Services.AuthApi.Infrastructure;

public sealed class ImageSharpImageProcessorTests
{
    [Fact]
    [Trait("TestType", "Security")]
    public async Task ProcessAvatar_ShouldRejectFileLargerThanLimit()
    {
        var sut = CreateProcessor();
        await using var stream = new MemoryStream(new byte[10]);

        var result = await sut.ProcessAvatarAsync(stream, sourceLength: 6 * 1024 * 1024, CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("INVALID_FILE_SIZE", result.Error!.Code);
    }

    [Fact]
    [Trait("TestType", "Security")]
    public async Task ProcessAvatar_ShouldRejectNonImageBytesByMagicByteCheck()
    {
        var sut = CreateProcessor();
        var bogus = new byte[] { 0x4D, 0x5A, 0x90, 0x00, 0x03 }; // PE header
        await using var stream = new MemoryStream(bogus);

        var result = await sut.ProcessAvatarAsync(stream, bogus.Length, CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("UNSUPPORTED_MEDIA_TYPE", result.Error!.Code);
    }

    [Fact]
    [Trait("TestType", "Security")]
    public async Task ProcessAvatar_ShouldRejectImagesSmallerThanMinDimension()
    {
        var sut = CreateProcessor();
        var bytes = CreatePngBytes(width: 32, height: 32);
        await using var stream = new MemoryStream(bytes);

        var result = await sut.ProcessAvatarAsync(stream, bytes.Length, CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Equal("INVALID_IMAGE_CONTENT", result.Error!.Code);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    public async Task ProcessAvatar_ShouldEmitThreeVariantsAtTargetDimensions()
    {
        var sut = CreateProcessor();
        var bytes = CreatePngBytes(width: 600, height: 600);
        await using var stream = new MemoryStream(bytes);

        var result = await sut.ProcessAvatarAsync(stream, bytes.Length, CancellationToken.None);

        Assert.True(result.IsSuccess);
        var processed = result.Value!;
        Assert.Equal(3, processed.Variants.Count);
        Assert.Contains(processed.Variants, v => v.Size == AvatarSize.Small && v.Width == 64 && v.Height == 64);
        Assert.Contains(processed.Variants, v => v.Size == AvatarSize.Medium && v.Width == 128 && v.Height == 128);
        Assert.Contains(processed.Variants, v => v.Size == AvatarSize.Large && v.Width == 512 && v.Height == 512);
        Assert.All(processed.Variants, v => Assert.Equal("image/webp", v.ContentType));
        Assert.All(processed.Variants, v => Assert.Equal(".webp", v.Extension));
    }

    [Fact]
    [Trait("TestType", "Security")]
    public async Task ProcessAvatar_ShouldStripExifFromReencodedVariants()
    {
        var sut = CreateProcessor();
        var bytes = CreateJpegWithExif(width: 256, height: 256, tag: "should-be-gone");
        await using var stream = new MemoryStream(bytes);

        var result = await sut.ProcessAvatarAsync(stream, bytes.Length, CancellationToken.None);

        Assert.True(result.IsSuccess);
        foreach (var variant in result.Value!.Variants)
        {
            using var reloaded = Image.Load(variant.Data);
            Assert.Null(reloaded.Metadata.ExifProfile);
        }
    }

    [Fact]
    [Trait("TestType", "Functional")]
    public async Task ProcessAvatar_ShouldProduceDeterministicContentHash()
    {
        var sut = CreateProcessor();
        var bytes = CreatePngBytes(width: 200, height: 200);

        await using var s1 = new MemoryStream(bytes);
        var first = await sut.ProcessAvatarAsync(s1, bytes.Length, CancellationToken.None);
        await using var s2 = new MemoryStream(bytes);
        var second = await sut.ProcessAvatarAsync(s2, bytes.Length, CancellationToken.None);

        Assert.True(first.IsSuccess && second.IsSuccess);
        Assert.Equal(first.Value!.ContentHash, second.Value!.ContentHash);
        Assert.Equal(16, first.Value!.ContentHash.Length);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    public async Task ProcessAvatar_ShouldAcceptValidWebp()
    {
        var sut = CreateProcessor();
        var bytes = CreateWebpBytes(width: 96, height: 96);
        await using var stream = new MemoryStream(bytes);

        var result = await sut.ProcessAvatarAsync(stream, bytes.Length, CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(3, result.Value!.Variants.Count);
    }

    private static ImageSharpImageProcessor CreateProcessor()
        => new(NullLogger<ImageSharpImageProcessor>.Instance);

    private static byte[] CreatePngBytes(int width, int height)
    {
        using var image = new Image<Rgba32>(width, height);
        using var ms = new MemoryStream();
        image.Save(ms, new PngEncoder());
        return ms.ToArray();
    }

    private static byte[] CreateWebpBytes(int width, int height)
    {
        using var image = new Image<Rgba32>(width, height);
        using var ms = new MemoryStream();
        image.Save(ms, new WebpEncoder());
        return ms.ToArray();
    }

    private static byte[] CreateJpegWithExif(int width, int height, string tag)
    {
        using var image = new Image<Rgba32>(width, height);
        var exif = new ExifProfile();
        exif.SetValue(ExifTag.ImageDescription, tag);
        image.Metadata.ExifProfile = exif;
        using var ms = new MemoryStream();
        image.Save(ms, new JpegEncoder { Quality = 90 });
        return ms.ToArray();
    }
}
