using Planora.Realtime.Application.Handlers;
using Planora.Realtime.Application.Interfaces;
using Planora.Realtime.Application.Response;
using Planora.Realtime.Domain.Entities;
using Planora.BuildingBlocks.Application.Messaging.Events;
using Microsoft.Extensions.Logging;
using Moq;
using Xunit;

namespace Planora.UnitTests.Services.RealtimeApi.Handlers;

/// <summary>
/// The realtime consumer persists each notification to the durable log (idempotent on the event id)
/// and pushes the persisted shape over SignalR. These tests pin: persist-then-push on a new event,
/// no push on a duplicate, and a malformed event is dropped rather than thrown.
/// </summary>
public class NotificationEventHandlerTests
{
    private readonly Mock<INotificationStore> _storeMock = new();
    private readonly Mock<INotificationService> _notificationServiceMock = new();
    private readonly NotificationEventHandler _handler;

    public NotificationEventHandlerTests()
    {
        _handler = new NotificationEventHandler(
            Mock.Of<ILogger<NotificationEventHandler>>(),
            _storeMock.Object,
            _notificationServiceMock.Object);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    public async Task HandleAsync_PersistsThenPushes_WhenEventIsNewAndValid()
    {
        var userId = Guid.NewGuid();
        var taskId = Guid.NewGuid();
        var actorId = Guid.NewGuid();
        var evt = new NotificationEvent(userId, "Title", "Message", NotificationType.CommentReply, taskId, actorId);

        _storeMock.Setup(x => x.TryAddAsync(It.IsAny<Notification>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);

        NotificationPayload? pushed = null;
        _notificationServiceMock
            .Setup(x => x.SendToUserAsync(It.IsAny<NotificationPayload>(), It.IsAny<CancellationToken>()))
            .Callback<NotificationPayload, CancellationToken>((p, _) => pushed = p)
            .Returns(Task.CompletedTask);

        await _handler.HandleAsync(evt);

        _storeMock.Verify(x => x.TryAddAsync(
            It.Is<Notification>(n => n.UserId == userId && n.TaskId == taskId && n.ActorId == actorId
                                     && n.Type == NotificationType.CommentReply && n.SourceEventId == evt.Id),
            It.IsAny<CancellationToken>()), Times.Once);

        Assert.NotNull(pushed);
        Assert.Equal(userId, pushed!.UserId);
        Assert.Equal(taskId, pushed.TaskId);
        Assert.Equal(NotificationType.CommentReply, pushed.Type);
        Assert.False(pushed.IsRead);
    }

    [Fact]
    [Trait("TestType", "Resilience")]
    [Trait("TestType", "Regression")]
    public async Task HandleAsync_DoesNotPush_WhenEventIsDuplicate()
    {
        var evt = new NotificationEvent(Guid.NewGuid(), "T", "M", NotificationType.CommentAdded, Guid.NewGuid(), Guid.NewGuid());
        _storeMock.Setup(x => x.TryAddAsync(It.IsAny<Notification>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(false); // already stored

        await _handler.HandleAsync(evt);

        _notificationServiceMock.Verify(
            x => x.SendToUserAsync(It.IsAny<NotificationPayload>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Theory]
    [Trait("TestType", "Security")]
    [InlineData(true, "msg", "type")]   // empty user
    [InlineData(false, "", "type")]      // empty message
    [InlineData(false, "msg", "")]       // empty type
    public async Task HandleAsync_DropsMalformedEvent_WithoutPersistingOrPushing(bool emptyUser, string message, string type)
    {
        var evt = new NotificationEvent(emptyUser ? Guid.Empty : Guid.NewGuid(), "T", message, type);

        await _handler.HandleAsync(evt);

        _storeMock.Verify(x => x.TryAddAsync(It.IsAny<Notification>(), It.IsAny<CancellationToken>()), Times.Never);
        _notificationServiceMock.Verify(
            x => x.SendToUserAsync(It.IsAny<NotificationPayload>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    [Trait("TestType", "Resilience")]
    public async Task HandleAsync_PropagatesPushFailures()
    {
        var evt = new NotificationEvent(Guid.NewGuid(), "T", "M", NotificationType.TaskStarted, Guid.NewGuid(), Guid.NewGuid());
        _storeMock.Setup(x => x.TryAddAsync(It.IsAny<Notification>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);
        _notificationServiceMock
            .Setup(x => x.SendToUserAsync(It.IsAny<NotificationPayload>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("hub down"));

        await Assert.ThrowsAsync<InvalidOperationException>(() => _handler.HandleAsync(evt));
    }
}
