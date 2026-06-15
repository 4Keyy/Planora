using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;
using Moq;
using Planora.Todo.Application.Services;
using Planora.Todo.Infrastructure.Services;

namespace Planora.UnitTests.Services.TodoApi.Infrastructure;

/// <summary>
/// The caching decorator collapses repeated friend-id lookups (the realtime feed-audience hot path)
/// while keeping the friendship authorization check live. These tests pin both halves of that
/// contract: the id list is cached, the AreFriends check is never cached.
/// </summary>
public sealed class CachingFriendshipServiceTests
{
    private static CachingFriendshipService Build(IFriendshipService inner) =>
        new(inner, new MemoryCache(new MemoryCacheOptions()), Mock.Of<ILogger<CachingFriendshipService>>());

    [Fact]
    [Trait("TestType", "Performance")]
    public async Task GetFriendIds_IsCached_SecondCallDoesNotHitInner()
    {
        var userId = Guid.NewGuid();
        var friends = new[] { Guid.NewGuid(), Guid.NewGuid() };
        var inner = new Mock<IFriendshipService>();
        inner.Setup(x => x.GetFriendIdsAsync(userId, It.IsAny<CancellationToken>())).ReturnsAsync(friends);
        var svc = Build(inner.Object);

        var first = await svc.GetFriendIdsAsync(userId, CancellationToken.None);
        var second = await svc.GetFriendIdsAsync(userId, CancellationToken.None);

        Assert.Equal(friends, first);
        Assert.Equal(friends, second);
        inner.Verify(x => x.GetFriendIdsAsync(userId, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    public async Task GetFriendIds_DifferentUsers_AreCachedIndependently()
    {
        var userA = Guid.NewGuid();
        var userB = Guid.NewGuid();
        var inner = new Mock<IFriendshipService>();
        inner.Setup(x => x.GetFriendIdsAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(Array.Empty<Guid>());
        var svc = Build(inner.Object);

        await svc.GetFriendIdsAsync(userA, CancellationToken.None);
        await svc.GetFriendIdsAsync(userB, CancellationToken.None);

        inner.Verify(x => x.GetFriendIdsAsync(userA, It.IsAny<CancellationToken>()), Times.Once);
        inner.Verify(x => x.GetFriendIdsAsync(userB, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    [Trait("TestType", "Security")]
    public async Task AreFriends_IsNeverCached_AlwaysHitsInner()
    {
        var a = Guid.NewGuid();
        var b = Guid.NewGuid();
        var inner = new Mock<IFriendshipService>();
        inner.Setup(x => x.AreFriendsAsync(a, b, It.IsAny<CancellationToken>())).ReturnsAsync(true);
        var svc = Build(inner.Object);

        await svc.AreFriendsAsync(a, b, CancellationToken.None);
        await svc.AreFriendsAsync(a, b, CancellationToken.None);

        // Authorization must always see live friendship state — never served from cache.
        inner.Verify(x => x.AreFriendsAsync(a, b, It.IsAny<CancellationToken>()), Times.Exactly(2));
    }
}
