using Microsoft.Extensions.Logging;
using Moq;
using Planora.BuildingBlocks.Application.Messaging.Events;
using Planora.Realtime.Application.Handlers;
using Planora.Realtime.Application.Interfaces;

namespace Planora.UnitTests.Services.RealtimeApi.Handlers;

/// <summary>
/// The sync handler is a pure router: it forwards a RealtimeSyncIntegrationEvent to the broadcaster's
/// feed and/or branch channel based purely on which targets the producer populated. It makes no
/// authorization decision of its own (the producer already resolved the audience).
/// </summary>
public sealed class RealtimeSyncEventHandlerTests
{
    private static (RealtimeSyncEventHandler handler, Mock<IRealtimeBroadcaster> broadcaster) Build()
    {
        var broadcaster = new Mock<IRealtimeBroadcaster>();
        var handler = new RealtimeSyncEventHandler(Mock.Of<ILogger<RealtimeSyncEventHandler>>(), broadcaster.Object);
        return (handler, broadcaster);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    public async Task FeedScopedEvent_PushesFeedOnly()
    {
        var (handler, broadcaster) = Build();
        var entity = Guid.NewGuid();
        var actor = Guid.NewGuid();
        var audience = new[] { Guid.NewGuid(), Guid.NewGuid() };

        await handler.HandleAsync(new RealtimeSyncIntegrationEvent(
            RealtimeSyncAction.TaskCreated, entity, actor, audienceUserIds: audience));

        broadcaster.Verify(x => x.FeedChangedAsync(
            audience, RealtimeSyncAction.TaskCreated, entity, actor, It.IsAny<CancellationToken>()), Times.Once);
        broadcaster.Verify(x => x.BranchChangedAsync(
            It.IsAny<Guid>(), It.IsAny<string>(), It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    public async Task BranchScopedEvent_PushesBranchOnly()
    {
        var (handler, broadcaster) = Build();
        var branch = Guid.NewGuid();
        var entity = Guid.NewGuid();
        var actor = Guid.NewGuid();

        await handler.HandleAsync(new RealtimeSyncIntegrationEvent(
            RealtimeSyncAction.CommentAdded, entity, actor, branchTaskId: branch));

        broadcaster.Verify(x => x.BranchChangedAsync(
            branch, RealtimeSyncAction.CommentAdded, entity, actor, It.IsAny<CancellationToken>()), Times.Once);
        broadcaster.Verify(x => x.FeedChangedAsync(
            It.IsAny<IReadOnlyList<Guid>>(), It.IsAny<string>(), It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    public async Task EventWithBothTargets_PushesBothChannels()
    {
        var (handler, broadcaster) = Build();
        var task = Guid.NewGuid();
        var actor = Guid.NewGuid();
        var audience = new[] { Guid.NewGuid() };

        await handler.HandleAsync(new RealtimeSyncIntegrationEvent(
            RealtimeSyncAction.TaskUpdated, task, actor, branchTaskId: task, audienceUserIds: audience));

        broadcaster.Verify(x => x.FeedChangedAsync(
            audience, RealtimeSyncAction.TaskUpdated, task, actor, It.IsAny<CancellationToken>()), Times.Once);
        broadcaster.Verify(x => x.BranchChangedAsync(
            task, RealtimeSyncAction.TaskUpdated, task, actor, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    public async Task EventWithNoTargets_PushesNothing()
    {
        var (handler, broadcaster) = Build();

        await handler.HandleAsync(new RealtimeSyncIntegrationEvent(
            RealtimeSyncAction.BranchActivity, Guid.NewGuid(), Guid.NewGuid()));

        broadcaster.Verify(x => x.FeedChangedAsync(
            It.IsAny<IReadOnlyList<Guid>>(), It.IsAny<string>(), It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<CancellationToken>()), Times.Never);
        broadcaster.Verify(x => x.BranchChangedAsync(
            It.IsAny<Guid>(), It.IsAny<string>(), It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<CancellationToken>()), Times.Never);
    }
}
