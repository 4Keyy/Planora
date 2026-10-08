using Planora.BuildingBlocks.Domain.Exceptions;
using Planora.Todo.Domain.Entities;

namespace Planora.UnitTests.Services.TodoApi.Domain;

public sealed class AllFriendsSnapshotDomainTests
{
    [Fact]
    public void Freeze_StoresOnlyTheChosenCircleAndEvictsOutsideWorkers()
    {
        var owner = Guid.NewGuid(); var early = Guid.NewGuid(); var late = Guid.NewGuid();
        var todo = TodoItem.Create(owner, "legacy", isPublic: true);
        todo.AddWorker(early); todo.AddWorker(late);
        var stamp = DateTime.UtcNow;
        todo.FreezeAllFriendsAudience([early, early, owner, Guid.Empty], stamp);
        Assert.True(todo.IsPublic);
        Assert.Equal(stamp, todo.AllFriendsSnapshotAt);
        Assert.Equal(new[] { early }, todo.SharedWith.Select(x => x.SharedWithUserId));
        Assert.Equal(new[] { early }, todo.Workers.Select(x => x.UserId));
        Assert.Null(todo.RequiredWorkers);
    }

    [Fact]
    public void Legacy_CleanupWaitsUntilTheAudienceIsFrozen()
    {
        var owner = Guid.NewGuid(); var friend = Guid.NewGuid();
        var todo = TodoItem.Create(owner, "legacy", isPublic: true);
        todo.AddWorker(friend); todo.SetSharedWith([], owner);
        Assert.Single(todo.Workers);
        todo.FreezeAllFriendsAudience([], DateTime.UtcNow);
        Assert.Empty(todo.Workers);
    }

    [Fact]
    public void PublicOffAndOn_ClearsThenReplacesTheStampAndAudience()
    {
        var owner = Guid.NewGuid(); var early = Guid.NewGuid(); var late = Guid.NewGuid();
        var first = DateTime.UtcNow.AddMinutes(-1);
        var todo = TodoItem.Create(owner, "snapshot", isPublic: true, sharedWithUserIds: [early], allFriendsSnapshotAt: first);
        todo.SetPublic(false, owner); todo.SetSharedWith([], owner);
        Assert.Null(todo.AllFriendsSnapshotAt);
        var second = DateTime.UtcNow;
        todo.FreezeAllFriendsAudience([late], second);
        Assert.Equal(second, todo.AllFriendsSnapshotAt);
        Assert.Equal(new[] { late }, todo.SharedWith.Select(x => x.SharedWithUserId));
    }

    [Fact]
    public void Subtasks_InheritTheStampAndAudienceOnCreateAndResync()
    {
        var owner = Guid.NewGuid(); var early = Guid.NewGuid(); var late = Guid.NewGuid();
        var stamp = DateTime.UtcNow;
        var parent = TodoItem.Create(owner, "parent", isPublic: true, sharedWithUserIds: [early], allFriendsSnapshotAt: stamp);
        var child = TodoItem.CreateSubtask(parent, early, "child", null);
        child.AddWorker(owner); child.AddWorker(early);
        Assert.Equal(stamp, child.AllFriendsSnapshotAt);
        Assert.Equal(new[] { early }, child.SharedWith.Select(x => x.SharedWithUserId));
        parent.FreezeAllFriendsAudience([late], stamp.AddMinutes(1));
        child.SyncInheritedFromParent(parent, owner);
        Assert.Equal(parent.AllFriendsSnapshotAt, child.AllFriendsSnapshotAt);
        Assert.Equal(new[] { late }, child.SharedWith.Select(x => x.SharedWithUserId));
        Assert.Equal(new[] { owner }, child.Workers.Select(x => x.UserId));
        parent.SetPublic(false, owner); parent.SetSharedWith([], owner);
        child.SyncInheritedFromParent(parent, owner);
        Assert.False(child.IsPublic); Assert.Null(child.AllFriendsSnapshotAt); Assert.Empty(child.SharedWith);
    }

    [Fact]
    public void SnapshotTimestamp_MustBeUtcAndBelongToAPublicTask()
    {
        var owner = Guid.NewGuid();
        Assert.Throws<InvalidValueObjectException>(() => TodoItem.Create(owner, "private", allFriendsSnapshotAt: DateTime.UtcNow));
        Assert.Throws<InvalidValueObjectException>(() => TodoItem.Create(owner, "public", isPublic: true, allFriendsSnapshotAt: DateTime.SpecifyKind(DateTime.UtcNow, DateTimeKind.Unspecified)));
        var task = TodoItem.Create(owner, "legacy", isPublic: true);
        Assert.Throws<InvalidValueObjectException>(() => task.FreezeAllFriendsAudience([], DateTime.SpecifyKind(DateTime.UtcNow, DateTimeKind.Local)));
        Assert.Null(task.AllFriendsSnapshotAt);
    }
}
