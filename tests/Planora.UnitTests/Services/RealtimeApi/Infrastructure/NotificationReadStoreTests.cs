using Microsoft.EntityFrameworkCore;
using Moq;
using Planora.BuildingBlocks.Application.Messaging;
using Planora.Realtime.Domain.Entities;
using Planora.Realtime.Infrastructure.Persistence;
using Planora.Realtime.Infrastructure.Services;

namespace Planora.UnitTests.Services.RealtimeApi.Infrastructure;

public sealed class NotificationReadStoreTests
{
    [Fact]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Regression")]
    public async Task GetSummary_GroupsUnreadByType_NewestFirst()
    {
        using var db = CreateContext();
        var userId = Guid.NewGuid();
        var taskId = Guid.NewGuid();
        var otherTask = Guid.NewGuid();
        var baseTime = new DateTime(2026, 6, 24, 12, 0, 0, DateTimeKind.Utc);

        // Task A: two older comment.added, one newer task.review → review is the latest type.
        db.Notifications.Add(Note(userId, taskId, "comment.added", baseTime));
        db.Notifications.Add(Note(userId, taskId, "comment.added", baseTime.AddMinutes(1)));
        db.Notifications.Add(Note(userId, taskId, "task.review", baseTime.AddMinutes(5)));
        // A read one must be excluded.
        var read = Note(userId, taskId, "task.completed", baseTime.AddMinutes(10));
        read.MarkRead();
        db.Notifications.Add(read);
        // A different task and a different user must not bleed in.
        db.Notifications.Add(Note(userId, otherTask, "task.shared", baseTime));
        db.Notifications.Add(Note(Guid.NewGuid(), taskId, "comment.added", baseTime));
        await db.SaveChangesAsync();

        var store = new NotificationReadStore(db);
        var summary = await store.GetSummaryAsync(userId);

        // 3 unread for task A + 1 for the other task = 4 total for this user.
        Assert.Equal(4, summary.TotalUnread);

        var taskA = Assert.Single(summary.PerTask, t => t.TaskId == taskId);
        Assert.Equal(3, taskA.Count);
        Assert.Equal("task.review", taskA.LatestType);
        // Groups: newest type first, with per-type counts; LatestType mirrors Groups[0].Type.
        Assert.Equal(2, taskA.Groups.Count);
        Assert.Equal("task.review", taskA.Groups[0].Type);
        Assert.Equal(1, taskA.Groups[0].Count);
        Assert.Equal("comment.added", taskA.Groups[1].Type);
        Assert.Equal(2, taskA.Groups[1].Count);
        Assert.True(taskA.Groups[0].LatestOccurredOnUtc > taskA.Groups[1].LatestOccurredOnUtc);
    }

    [Fact]
    [Trait("TestType", "Module")]
    public async Task GetSummary_ReturnsEmpty_WhenNothingUnread()
    {
        using var db = CreateContext();
        var store = new NotificationReadStore(db);

        var summary = await store.GetSummaryAsync(Guid.NewGuid());

        Assert.Equal(0, summary.TotalUnread);
        Assert.Empty(summary.PerTask);
    }

    private static Notification Note(Guid userId, Guid taskId, string type, DateTime occurredOnUtc)
        => new(userId, "title", "message", type, occurredOnUtc, Guid.NewGuid(), taskId);

    private static RealtimeDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<RealtimeDbContext>()
            .UseInMemoryDatabase($"realtime-notifications-{Guid.NewGuid():N}")
            .Options;
        return new RealtimeDbContext(options, Mock.Of<IDomainEventDispatcher>());
    }
}
