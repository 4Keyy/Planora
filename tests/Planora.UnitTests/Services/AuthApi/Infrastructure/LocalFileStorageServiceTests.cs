using Planora.Auth.Infrastructure.Services.Common;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;

namespace Planora.UnitTests.Services.AuthApi.Infrastructure;

public sealed class LocalFileStorageServiceTests : IDisposable
{
    private readonly string _root;

    public LocalFileStorageServiceTests()
    {
        _root = Path.Combine(Path.GetTempPath(), "planora-storage-tests-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_root);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    public async Task SaveBytesAsync_ShouldPersistFileUnderFolderWithGuidSuffix()
    {
        var sut = CreateService();
        var data = new byte[] { 1, 2, 3, 4 };

        var url = await sut.SaveBytesAsync(data, "avatar-abc.webp", "avatars", CancellationToken.None);

        Assert.StartsWith("/avatars/", url);
        var relative = url.TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
        var full = Path.Combine(_root, relative);
        Assert.True(File.Exists(full));
        Assert.Equal(data, await File.ReadAllBytesAsync(full));
    }

    [Fact]
    [Trait("TestType", "Security")]
    public async Task SaveBytesAsync_ShouldRejectFolderWithPathSeparator()
    {
        var sut = CreateService();

        await Assert.ThrowsAsync<ArgumentException>(() =>
            sut.SaveBytesAsync(new byte[] { 1 }, "name.webp", "../etc", CancellationToken.None));
    }

    [Fact]
    [Trait("TestType", "Security")]
    public async Task SaveBytesAsync_ShouldStripInvalidFilenameCharacters()
    {
        var sut = CreateService();

        var url = await sut.SaveBytesAsync(new byte[] { 1 }, "../danger:name?.webp", "avatars", CancellationToken.None);

        Assert.DoesNotContain("..", url);
        Assert.DoesNotContain("?", url);
        Assert.DoesNotContain(":", url);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    public async Task DeleteFile_ShouldRemoveExistingFile()
    {
        var sut = CreateService();
        var url = await sut.SaveBytesAsync(new byte[] { 1 }, "x.webp", "avatars", CancellationToken.None);

        sut.DeleteFile(url);

        var relative = url.TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
        Assert.False(File.Exists(Path.Combine(_root, relative)));
    }

    [Fact]
    [Trait("TestType", "Security")]
    public void DeleteFile_ShouldRefusePathOutsideUploadsRoot()
    {
        var outsideFile = Path.Combine(Path.GetTempPath(), "outsider-" + Guid.NewGuid().ToString("N") + ".txt");
        File.WriteAllText(outsideFile, "secret");

        var sut = CreateService();
        try
        {
            sut.DeleteFile("/../../../" + Path.GetFileName(outsideFile));
            Assert.True(File.Exists(outsideFile));
        }
        finally
        {
            File.Delete(outsideFile);
        }
    }

    private LocalFileStorageService CreateService()
    {
        var env = new Mock<IWebHostEnvironment>();
        env.SetupGet(x => x.WebRootPath).Returns(_root);
        env.SetupGet(x => x.ContentRootPath).Returns(_root);
        env.SetupGet(x => x.WebRootFileProvider).Returns(new NullFileProvider());
        return new LocalFileStorageService(env.Object, NullLogger<LocalFileStorageService>.Instance);
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
        catch
        {
            // best-effort cleanup
        }
    }
}
