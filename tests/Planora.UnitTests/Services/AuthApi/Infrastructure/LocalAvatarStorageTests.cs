using Planora.Auth.Application.Common.Interfaces;
using Planora.Auth.Infrastructure.Services.Common;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;

namespace Planora.UnitTests.Services.AuthApi.Infrastructure;

public sealed class LocalAvatarStorageTests : IDisposable
{
    private readonly string _root;

    public LocalAvatarStorageTests()
    {
        _root = Path.Combine(Path.GetTempPath(), "planora-avatar-tests-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_root);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    public async Task PutAsync_ShouldPersistAllVariantsUnderHashedPath()
    {
        var sut = CreateService();
        var userId = Guid.NewGuid();
        var processed = new ProcessedAvatar(
            ContentHash: "deadbeefcafebabe",
            Variants: new[]
            {
                new AvatarVariant(AvatarSize.Small, new byte[] { 1, 1, 1 }, "image/webp", ".webp", 64, 64),
                new AvatarVariant(AvatarSize.Medium, new byte[] { 2, 2, 2 }, "image/webp", ".webp", 128, 128),
                new AvatarVariant(AvatarSize.Large, new byte[] { 3, 3, 3 }, "image/webp", ".webp", 512, 512),
            });

        var manifest = await sut.PutAsync(userId, processed, CancellationToken.None);

        Assert.EndsWith($"/{userId:N}/deadbeefcafebabe/64.webp", manifest.SmallUrl);
        Assert.EndsWith($"/{userId:N}/deadbeefcafebabe/128.webp", manifest.MediumUrl);
        Assert.EndsWith($"/{userId:N}/deadbeefcafebabe/512.webp", manifest.LargeUrl);
        Assert.Equal(manifest.MediumUrl, manifest.CanonicalUrl);

        foreach (var url in new[] { manifest.SmallUrl, manifest.MediumUrl, manifest.LargeUrl })
        {
            var relative = url.TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
            var full = Path.Combine(_root, relative);
            Assert.True(File.Exists(full), $"Expected {full} to exist");
        }
    }

    [Fact]
    [Trait("TestType", "Functional")]
    public async Task PutAsync_ShouldPruneOlderRevisionsForSameUser()
    {
        var sut = CreateService();
        var userId = Guid.NewGuid();

        await sut.PutAsync(userId, MakeProcessed("hash-old"), CancellationToken.None);
        await sut.PutAsync(userId, MakeProcessed("hash-new"), CancellationToken.None);

        var userFolder = Path.Combine(_root, "avatars", userId.ToString("N"));
        var remaining = Directory.GetDirectories(userFolder).Select(Path.GetFileName).ToList();
        Assert.Single(remaining);
        Assert.Equal("hash-new", remaining[0]);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    public async Task DeleteAsync_ShouldRemoveAllUserAvatarFiles()
    {
        var sut = CreateService();
        var userId = Guid.NewGuid();
        await sut.PutAsync(userId, MakeProcessed("any-hash"), CancellationToken.None);

        await sut.DeleteAsync(userId, CancellationToken.None);

        Assert.False(Directory.Exists(Path.Combine(_root, "avatars", userId.ToString("N"))));
    }

    [Fact]
    [Trait("TestType", "Security")]
    public async Task PutAsync_ShouldRejectEmptyUserId()
    {
        var sut = CreateService();
        await Assert.ThrowsAsync<ArgumentException>(() =>
            sut.PutAsync(Guid.Empty, MakeProcessed("any"), CancellationToken.None));
    }

    private static ProcessedAvatar MakeProcessed(string hash) => new(
        ContentHash: hash,
        Variants: new[]
        {
            new AvatarVariant(AvatarSize.Small, new byte[] { 1 }, "image/webp", ".webp", 64, 64),
            new AvatarVariant(AvatarSize.Medium, new byte[] { 2 }, "image/webp", ".webp", 128, 128),
            new AvatarVariant(AvatarSize.Large, new byte[] { 3 }, "image/webp", ".webp", 512, 512),
        });

    private LocalAvatarStorage CreateService()
    {
        var env = new Mock<IWebHostEnvironment>();
        env.SetupGet(x => x.WebRootPath).Returns(_root);
        env.SetupGet(x => x.ContentRootPath).Returns(_root);
        env.SetupGet(x => x.WebRootFileProvider).Returns(new NullFileProvider());
        return new LocalAvatarStorage(env.Object, NullLogger<LocalAvatarStorage>.Instance);
    }

    public void Dispose()
    {
        try
        {
            if (Directory.Exists(_root))
            {
                Directory.Delete(_root, recursive: true);
            }
        }
        catch { /* best effort */ }
    }
}
