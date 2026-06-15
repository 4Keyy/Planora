using Microsoft.Extensions.Logging;
using Moq;
using Planora.Todo.Application.Common;
using Planora.Todo.Application.Services;
using Planora.Todo.Domain.Entities;

namespace Planora.UnitTests.Services.TodoApi.Common;

/// <summary>
/// The feed-audience resolver decides who receives a task's live-sync push. These tests pin the
/// visibility rule (owner + shared-with + friends-when-public) and — critically — that friend
/// resolution is best-effort: a transient Auth-gRPC failure must NOT throw, so the underlying task
/// mutation that triggered the sync is never brought down by a non-critical UX enhancement.
/// </summary>
public sealed class RealtimeAudienceTests
{
    private static Mock<IFriendshipService> FriendshipReturning(params Guid[] friends)
    {
        var mock = new Mock<IFriendshipService>();
        mock.Setup(x => x.GetFriendIdsAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(friends);
        return mock;
    }

    [Fact]
    [Trait("TestType", "Functional")]
    public async Task PrivateTask_AudienceIsOwnerOnly_AndDoesNotQueryFriends()
    {
        var owner = Guid.NewGuid();
        var friendship = FriendshipReturning(Guid.NewGuid());

        var audience = await RealtimeAudience.ResolveAsync(
            owner, isPublic: false, Array.Empty<Guid>(), friendship.Object, CancellationToken.None);

        Assert.Equal(new[] { owner }, audience);
        friendship.Verify(x => x.GetFriendIdsAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    public async Task SharedPrivateTask_AudienceIsOwnerPlusSharedWith_NoFriends()
    {
        var owner = Guid.NewGuid();
        var friendA = Guid.NewGuid();
        var sharedWith = Guid.NewGuid();
        var friendship = FriendshipReturning(friendA);

        var audience = await RealtimeAudience.ResolveAsync(
            owner, isPublic: false, new[] { sharedWith }, friendship.Object, CancellationToken.None);

        Assert.Contains(owner, audience);
        Assert.Contains(sharedWith, audience);
        Assert.DoesNotContain(friendA, audience);
        friendship.Verify(x => x.GetFriendIdsAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    public async Task PublicTask_AudienceIncludesFriendsAndSharedWith_Deduped()
    {
        var owner = Guid.NewGuid();
        var friendA = Guid.NewGuid();
        var shared = Guid.NewGuid();
        var friendship = FriendshipReturning(friendA, owner /* dupe of owner is collapsed */);

        var audience = await RealtimeAudience.ResolveAsync(
            owner, isPublic: true, new[] { shared, shared /* dupe */ }, friendship.Object, CancellationToken.None);

        Assert.Equal(new HashSet<Guid> { owner, friendA, shared }, audience.ToHashSet());
    }

    [Fact]
    [Trait("TestType", "Functional")]
    public async Task EntityOverload_ProjectsSharedWithAndOwner()
    {
        var owner = Guid.NewGuid();
        var friend = Guid.NewGuid();
        var todo = TodoItem.Create(owner, "Public", isPublic: true, sharedWithUserIds: new[] { friend });
        var friendship = FriendshipReturning();

        var audience = await RealtimeAudience.ResolveAsync(todo, friendship.Object, CancellationToken.None);

        Assert.Contains(owner, audience);
        Assert.Contains(friend, audience); // shared-with on the entity
    }

    [Fact]
    [Trait("TestType", "Resilience")]
    [Trait("TestType", "Regression")]
    public async Task FriendLookupFailure_DegradesToOwnerPlusShared_DoesNotThrow()
    {
        var owner = Guid.NewGuid();
        var shared = Guid.NewGuid();
        var friendship = new Mock<IFriendshipService>();
        friendship.Setup(x => x.GetFriendIdsAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("Auth gRPC down"));

        // Must not throw — the live-sync push degrades, the mutation that called it survives.
        var audience = await RealtimeAudience.ResolveAsync(
            owner, isPublic: true, new[] { shared }, friendship.Object, CancellationToken.None,
            Mock.Of<ILogger>());

        Assert.Equal(new HashSet<Guid> { owner, shared }, audience.ToHashSet());
    }

    [Fact]
    [Trait("TestType", "Resilience")]
    public async Task FriendLookupCancellation_Propagates()
    {
        var friendship = new Mock<IFriendshipService>();
        friendship.Setup(x => x.GetFriendIdsAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new OperationCanceledException());

        await Assert.ThrowsAsync<OperationCanceledException>(() =>
            RealtimeAudience.SafeGetFriendIdsAsync(
                friendship.Object, Guid.NewGuid(), CancellationToken.None));
    }
}
