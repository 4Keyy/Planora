using Planora.Realtime.Application.Handlers;
using Planora.Realtime.Application.Interfaces;
using Planora.BuildingBlocks.Infrastructure.Messaging.Events;
using Microsoft.Extensions.Logging;
using Moq;
using Xunit;

namespace Planora.UnitTests.Services.RealtimeApi.Handlers;

public class NotificationEventHandlerTests
{
    private readonly Mock<INotificationService> _notificationServiceMock;
    private readonly Mock<ILogger<NotificationEventHandler>> _loggerMock;
    private readonly NotificationEventHandler _handler;

    public NotificationEventHandlerTests()
    {
        _notificationServiceMock = new Mock<INotificationService>();
        _loggerMock = new Mock<ILogger<NotificationEventHandler>>();
        _handler = new NotificationEventHandler(_loggerMock.Object, _notificationServiceMock.Object);
    }

    [Fact]
    public async Task HandleAsync_ShouldCallSendNotificationAsync_WhenEventIsValid()
    {
        // Arrange
        var userId = Guid.NewGuid();
        var notificationEvent = new NotificationEvent(userId, "Test Title", "Test message", "Info");

        // Act
        await _handler.HandleAsync(notificationEvent);

        // Assert
        _notificationServiceMock.Verify(x => x.SendNotificationAsync(
            userId.ToString(),
            notificationEvent.Message,
            notificationEvent.Type,
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    [Trait("TestType", "Resilience")]
    [Trait("TestType", "Regression")]
    public async Task HandleAsync_ShouldLogAndRethrowNotificationFailures()
    {
        var notificationEvent = new NotificationEvent(Guid.NewGuid(), "Test Title", "Test message", "Info");
        _notificationServiceMock
            .Setup(x => x.SendNotificationAsync(
                notificationEvent.UserId.ToString(),
                notificationEvent.Message,
                notificationEvent.Type,
                It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("notification service down"));

        await Assert.ThrowsAsync<InvalidOperationException>(() => _handler.HandleAsync(notificationEvent));
    }
}
