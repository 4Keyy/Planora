using System.Buffers.Binary;
using System.Text;
using Planora.Auth.Application.Features.Users.Validators.UploadAvatar;
using Planora.Auth.Infrastructure.Services.Common;
using SkiaSharp;

namespace Planora.UnitTests.Services.AuthApi.Infrastructure;

public sealed class AvatarDecodeBoundaryTests
{
    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    public async Task ActualBytes_AreBoundedEvenWhenDeclaredLengthIsWrong(long declared)
    {
        using var source = new CountingStream(new byte[UploadAvatarCommandValidator.MaxFileSizeBytes + 32]);
        var result = await new SkiaImageProcessor().ProcessAvatarAsync(source, declared);
        Assert.True(result.IsFailure);
        Assert.Equal("INVALID_FILE_SIZE", result.Error!.Code);
        Assert.Equal(UploadAvatarCommandValidator.MaxFileSizeBytes + 1, source.ReadBytes);
    }

    [Fact]
    public async Task NegativeDeclaredLength_IsRejectedWithoutReading()
    {
        using var source = new CountingStream([1, 2, 3]);
        var result = await new SkiaImageProcessor().ProcessAvatarAsync(source, -1);
        Assert.Equal("INVALID_FILE_SIZE", result.Error!.Code);
        Assert.Equal(0, source.ReadBytes);
    }

    [Theory]
    [InlineData(4097, 64)]
    [InlineData(64, 4097)]
    [InlineData(63, 64)]
    public async Task OutOfRangeDimensions_AreRejected(int width, int height)
    {
        var bytes = SkiaAvatarFixture.Image(width, height, SKEncodedImageFormat.Png);
        using var source = new MemoryStream(bytes);
        var result = await new SkiaImageProcessor().ProcessAvatarAsync(source, bytes.Length);
        Assert.True(result.IsFailure);
        Assert.Equal("INVALID_IMAGE_CONTENT", result.Error!.Code);
    }

    [Fact]
    public async Task TruncatedImage_IsRejectedInsteadOfEmittingPartialPixels()
    {
        var bytes = SkiaAvatarFixture.Image(128, 128, SKEncodedImageFormat.Jpeg);
        using var source = new MemoryStream(bytes[..(bytes.Length / 2)]);
        var result = await new SkiaImageProcessor().ProcessAvatarAsync(source, source.Length);
        Assert.True(result.IsFailure);
        Assert.Equal("INVALID_IMAGE_CONTENT", result.Error!.Code);
    }

    [Fact]
    public async Task Cancellation_PropagatesInsteadOfBecomingAnInvalidImage()
    {
        using var cancellation = new CancellationTokenSource(); cancellation.Cancel();
        using var source = new MemoryStream([1, 2, 3]);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => new SkiaImageProcessor().ProcessAvatarAsync(source, 3, cancellation.Token));
    }

    [Fact]
    public async Task RectangularInput_IsCroppedToItsCentreInEveryDecodableVariant()
    {
        using var bitmap = new SKBitmap(192, 64);
        using (var canvas = new SKCanvas(bitmap))
        using (var paint = new SKPaint())
        {
            paint.Color = SKColors.Red; canvas.DrawRect(SKRect.Create(0, 0, 64, 64), paint);
            paint.Color = SKColors.Lime; canvas.DrawRect(SKRect.Create(64, 0, 64, 64), paint);
            paint.Color = SKColors.Blue; canvas.DrawRect(SKRect.Create(128, 0, 64, 64), paint);
        }
        using var image = SKImage.FromBitmap(bitmap);
        using var encoded = image.Encode(SKEncodedImageFormat.Png, 100);
        var bytes = encoded.ToArray();
        using var source = new MemoryStream(bytes);
        var result = await new SkiaImageProcessor().ProcessAvatarAsync(source, bytes.Length);
        Assert.True(result.IsSuccess);
        foreach (var variant in result.Value!.Variants)
        {
            using var decoded = SKBitmap.Decode(variant.Data);
            Assert.NotNull(decoded);
            Assert.Equal((int)variant.Size, decoded.Width);
            Assert.Equal(decoded.Width, decoded.Height);
            var centre = decoded.GetPixel(decoded.Width / 2, decoded.Height / 2);
            Assert.True(centre.Green > 230 && centre.Red < 20 && centre.Blue < 20);
        }
    }

    [Fact]
    public async Task RealExifInput_IsNotCopiedToAnyEncodedVariant()
    {
        const string marker = "private-camera-description";
        var bytes = SkiaAvatarFixture.WithExif(SkiaAvatarFixture.Image(128, 128, SKEncodedImageFormat.Jpeg), marker);
        Assert.Contains(marker, Encoding.ASCII.GetString(bytes));
        using var source = new MemoryStream(bytes);
        var result = await new SkiaImageProcessor().ProcessAvatarAsync(source, bytes.Length);
        Assert.True(result.IsSuccess);
        Assert.All(result.Value!.Variants, variant =>
        {
            Assert.DoesNotContain(marker, Encoding.ASCII.GetString(variant.Data));
            var chunks = SkiaAvatarFixture.Chunks(variant.Data);
            Assert.DoesNotContain("EXIF", chunks);
            Assert.DoesNotContain("ICCP", chunks);
            Assert.DoesNotContain("XMP ", chunks);
        });
    }

    private sealed class CountingStream(byte[] bytes) : MemoryStream(bytes)
    {
        public int ReadBytes { get; private set; }
        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
        {
            var count = await base.ReadAsync(buffer, cancellationToken);
            ReadBytes += count; return count;
        }
    }
}

internal static class SkiaAvatarFixture
{
    internal static byte[] Image(int width, int height, SKEncodedImageFormat format)
    {
        using var bitmap = new SKBitmap(width, height); bitmap.Erase(SKColors.Teal);
        using var image = SKImage.FromBitmap(bitmap);
        using var encoded = image.Encode(format, 90);
        return encoded.ToArray();
    }
    internal static byte[] WithExif(byte[] jpeg, string description)
    {
        // Standard JPEG APP1 containing a little-endian TIFF ImageDescription entry.
        var text = Encoding.ASCII.GetBytes(description + '\0');
        using var payload = new MemoryStream();
        using (var writer = new BinaryWriter(payload, Encoding.ASCII, leaveOpen: true))
        {
            writer.Write("Exif\0\0"u8); writer.Write("II"u8); writer.Write((ushort)42); writer.Write(8u);
            writer.Write((ushort)1); writer.Write((ushort)0x010e); writer.Write((ushort)2);
            writer.Write((uint)text.Length); writer.Write(26u); writer.Write(0u); writer.Write(text);
        }
        var body = payload.ToArray();
        using var output = new MemoryStream(); output.Write(jpeg, 0, 2);
        output.WriteByte(0xff); output.WriteByte(0xe1);
        output.WriteByte((byte)((body.Length + 2) >> 8)); output.WriteByte((byte)(body.Length + 2));
        output.Write(body); output.Write(jpeg, 2, jpeg.Length - 2); return output.ToArray();
    }
    internal static IReadOnlyList<string> Chunks(byte[] webp)
    {
        Assert.True(webp.AsSpan(0, 4).SequenceEqual("RIFF"u8));
        Assert.True(webp.AsSpan(8, 4).SequenceEqual("WEBP"u8));
        var result = new List<string>();
        for (var offset = 12; offset + 8 <= webp.Length;)
        {
            result.Add(Encoding.ASCII.GetString(webp, offset, 4));
            var length = BinaryPrimitives.ReadUInt32LittleEndian(webp.AsSpan(offset + 4, 4));
            Assert.True(length <= webp.Length - offset - 8);
            offset += 8 + checked((int)length) + (int)(length & 1);
        }
        return result;
    }
}
