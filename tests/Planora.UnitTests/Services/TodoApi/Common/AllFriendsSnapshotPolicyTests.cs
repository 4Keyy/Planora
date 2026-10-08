using Moq;
using Planora.Todo.Application.Common;
using Planora.Todo.Application.Services;
using Planora.Todo.Domain.Entities;

namespace Planora.UnitTests.Services.TodoApi.Common;

public sealed class AllFriendsSnapshotPolicyTests
{
    [Theory]
    [InlineData(true, true, true)]
    [InlineData(true, false, false)]
    [InlineData(false, true, false)]
    [InlineData(false, false, false)]
    public async Task FrozenPublicTask_RequiresBothSnapshotMembershipAndLiveFriendship(bool inSnapshot, bool liveFriend, bool expected)
    {
        var owner = Guid.NewGuid(); var viewer = Guid.NewGuid();
        var task = TodoItem.Create(owner, "frozen", isPublic: true, sharedWithUserIds: inSnapshot ? [viewer] : [], allFriendsSnapshotAt: DateTime.UtcNow);
        var friends = new Mock<IFriendshipService>();
        friends.Setup(x => x.AreFriendsAsync(viewer, owner, It.IsAny<CancellationToken>())).ReturnsAsync(liveFriend);
        Assert.Equal(expected, await TodoAccessPolicy.CanAccessAsync(task, viewer, friends.Object, CancellationToken.None));
        Assert.Equal(expected, TodoAccessPolicy.VisibleTo(viewer, liveFriend ? [owner] : []).Compile()(task));
        Assert.True(await TodoAccessPolicy.CanAccessAsync(task, owner, friends.Object, CancellationToken.None));
    }

    [Fact]
    public async Task LegacyPublicTask_UsesCurrentFriendsUntilFrozen()
    {
        var owner = Guid.NewGuid(); var viewer = Guid.NewGuid();
        var task = TodoItem.Create(owner, "legacy", isPublic: true);
        var friends = new Mock<IFriendshipService>();
        friends.Setup(x => x.AreFriendsAsync(viewer, owner, It.IsAny<CancellationToken>())).ReturnsAsync(true);
        Assert.True(await TodoAccessPolicy.CanAccessAsync(task, viewer, friends.Object, CancellationToken.None));
        Assert.True(TodoAccessPolicy.VisibleTo(viewer, [owner]).Compile()(task));
        task.FreezeAllFriendsAudience([], task.CreatedAt);
        Assert.False(await TodoAccessPolicy.CanAccessAsync(task, viewer, friends.Object, CancellationToken.None));
    }

    [Fact]
    public void LegacyAudience_UsesAcceptanceAtCreationAndPreservesExistingExplicitShares()
    {
        var task = TodoItem.Create(Guid.NewGuid(), "legacy", isPublic: true);
        var old = Guid.NewGuid(); var equal = Guid.NewGuid(); var undated = Guid.NewGuid(); var late = Guid.NewGuid(); var explicitShare = Guid.NewGuid();
        task.SetSharedWith([explicitShare], task.UserId);
        var actual = AllFriendsSnapshotAudience.ForLegacy(task, [
            new(old, task.CreatedAt.AddSeconds(-1)), new(equal, task.CreatedAt), new(undated, null),
            new(late, task.CreatedAt.AddSeconds(1)), new(explicitShare, task.CreatedAt.AddSeconds(5))]);
        Assert.Equal(new HashSet<Guid> { old, equal, undated, explicitShare }, actual.ToHashSet());
        Assert.DoesNotContain(late, actual);
    }

    [Fact]
    public async Task ContentAudience_PreservesCancellation()
    {
        var task = TodoItem.Create(Guid.NewGuid(), "frozen", isPublic: true, allFriendsSnapshotAt: DateTime.UtcNow);
        var friends = new Mock<IFriendshipService>();
        friends.Setup(x => x.GetFriendshipsAsync(task.UserId, It.IsAny<CancellationToken>()))
            .ThrowsAsync(new OperationCanceledException());
        await Assert.ThrowsAsync<OperationCanceledException>(() => RealtimeAudience.ResolveContentAsync(task, friends.Object, default));
    }

    [Fact]
    public async Task FrozenRealtimeAudience_DoesNotIncludeFriendsAddedLater()
    {
        var owner = Guid.NewGuid(); var early = Guid.NewGuid(); var late = Guid.NewGuid();
        var task = TodoItem.Create(owner, "frozen", isPublic: true, sharedWithUserIds: [early], allFriendsSnapshotAt: DateTime.UtcNow);
        var friends = new Mock<IFriendshipService>();
        friends.Setup(x => x.GetFriendIdsAsync(owner, It.IsAny<CancellationToken>())).ReturnsAsync([early, late]);
        var audience = await RealtimeAudience.ResolveAsync(task, friends.Object, CancellationToken.None);
        Assert.Equal(new HashSet<Guid> { owner, early }, audience.ToHashSet());
        friends.Verify(x => x.GetFriendIdsAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()), Times.Never);
    }
}
