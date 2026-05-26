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
        var bogus = new byte[] { 0x4D, 0x5A, 0x90, 0x00, 0x03 }; // PE header — disguised executable
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
    public async Task ProcessAvatar_ShouldReencodeJpegToWebpAndStripExif()
    {
        var sut = CreateProcessor();
        var bytes = CreateJpegWithExif(width: 256, height: 256, gpsTag: "stripped");
        await using var stream = new MemoryStream(bytes);

        var result = await sut.ProcessAvatarAsync(stream, bytes.Length, CancellationToken.None);

        Assert.True(result.IsSuccess);
        var processed = result.Value!;
        Assert.Equal("image/webp", processed.ContentType);
        Assert.Equal(".webp", processed.Extension);
        Assert.Equal(256, processed.Width);
        Assert.Equal(256, processed.Height);

        // Decode the re-encoded bytes and verify EXIF metadata is gone.
        using var reloaded = Image.Load(processed.Data);
        Assert.Null(reloaded.Metadata.ExifProfile);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    public async Task ProcessAvatar_ShouldAcceptValidPng()
    {
        var sut = CreateProcessor();
        var bytes = CreatePngBytes(width: 128, height: 128);
        await using var stream = new MemoryStream(bytes);

        var result = await sut.ProcessAvatarAsync(stream, bytes.Length, CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal("image/webp", result.Value!.ContentType);
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
        Assert.Equal(96, result.Value!.Width);
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

    private static byte[] CreateJpegWithExif(int width, int height, string gpsTag)
    {
        using var image = new Image<Rgba32>(width, height);
        var exif = new ExifProfile();
        exif.SetValue(ExifTag.ImageDescription, gpsTag);
        image.Metadata.ExifProfile = exif;
        using var ms = new MemoryStream();
        image.Save(ms, new JpegEncoder { Quality = 90 });
        return ms.ToArray();
    }
}
