using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Planora.Todo.Application.Services;
using Planora.Todo.Infrastructure.Services;

namespace Planora.UnitTests.Services.TodoApi.Infrastructure;

public sealed class CachingUserServiceTests
{
    [Fact]
    [Trait("TestType", "Functional")]
    public async Task GetUserAvatars_ShouldHitInnerServiceOnceWhenCalledTwiceForSameId()
    {
        var userId = Guid.NewGuid();
        var inner = new Mock<IUserService>();
        inner.Setup(x => x.GetUserAvatarsAsync(It.IsAny<IEnumerable<Guid>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<Guid, string> { [userId] = "/avatars/abc.webp" });

        var sut = CreateService(inner.Object);

        var first = await sut.GetUserAvatarsAsync(new[] { userId }, CancellationToken.None);
        var second = await sut.GetUserAvatarsAsync(new[] { userId }, CancellationToken.None);

        Assert.Equal("/avatars/abc.webp", first[userId]);
        Assert.Equal("/avatars/abc.webp", second[userId]);
        inner.Verify(x => x.GetUserAvatarsAsync(It.IsAny<IEnumerable<Guid>>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    public async Task GetUserAvatars_ShouldOnlyFetchMissingIds()
    {
        var cached = Guid.NewGuid();
        var fresh = Guid.NewGuid();
        var capturedRequests = new List<List<Guid>>();

        var inner = new Mock<IUserService>();
        inner.Setup(x => x.GetUserAvatarsAsync(It.IsAny<IEnumerable<Guid>>(), It.IsAny<CancellationToken>()))
            .Callback<IEnumerable<Guid>, CancellationToken>((ids, _) => capturedRequests.Add(ids.ToList()))
            .ReturnsAsync((IEnumerable<Guid> ids, CancellationToken _) =>
            {
                var map = new Dictionary<Guid, string>();
                foreach (var id in ids)
                {
                    if (id == cached) map[id] = "/avatars/cached.webp";
                    else if (id == fresh) map[id] = "/avatars/fresh.webp";
                }
                return map;
            });

        var sut = CreateService(inner.Object);

        await sut.GetUserAvatarsAsync(new[] { cached }, CancellationToken.None);
        var second = await sut.GetUserAvatarsAsync(new[] { cached, fresh }, CancellationToken.None);

        Assert.Equal("/avatars/cached.webp", second[cached]);
        Assert.Equal("/avatars/fresh.webp", second[fresh]);
        Assert.Equal(2, capturedRequests.Count);
        Assert.Single(capturedRequests[1]);
        Assert.Equal(fresh, capturedRequests[1][0]);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    public async Task GetUserAvatars_ShouldCacheNegativeResultsToAvoidStampede()
    {
        var unknown = Guid.NewGuid();
        var inner = new Mock<IUserService>();
        inner.Setup(x => x.GetUserAvatarsAsync(It.IsAny<IEnumerable<Guid>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<Guid, string>());

        var sut = CreateService(inner.Object);

        await sut.GetUserAvatarsAsync(new[] { unknown }, CancellationToken.None);
        await sut.GetUserAvatarsAsync(new[] { unknown }, CancellationToken.None);
        await sut.GetUserAvatarsAsync(new[] { unknown }, CancellationToken.None);

        inner.Verify(x => x.GetUserAvatarsAsync(It.IsAny<IEnumerable<Guid>>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    public async Task GetUserAvatars_ShouldShortCircuitOnEmptyInput()
    {
        var inner = new Mock<IUserService>();
        var sut = CreateService(inner.Object);

        var result = await sut.GetUserAvatarsAsync(Array.Empty<Guid>(), CancellationToken.None);

        Assert.Empty(result);
        inner.Verify(x => x.GetUserAvatarsAsync(It.IsAny<IEnumerable<Guid>>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    private static CachingUserService CreateService(IUserService inner)
    {
        var cache = new MemoryCache(new MemoryCacheOptions { SizeLimit = 1000 });
        return new CachingUserService(inner, cache, NullLogger<CachingUserService>.Instance);
    }
}
