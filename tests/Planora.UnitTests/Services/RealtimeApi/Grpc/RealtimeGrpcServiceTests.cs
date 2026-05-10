using Grpc.Core;
using Grpc.Core.Testing;
using Planora.GrpcContracts;
using Planora.Realtime.Api.Grpc;
using Planora.Realtime.Application.Interfaces;
using Microsoft.Extensions.Logging;
using Moq;

namespace Planora.UnitTests.Services.RealtimeApi.Grpc;

public sealed class RealtimeGrpcServiceTests
{
    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Regression")]
    public async Task BroadcastNotification_ShouldSendToAllAndReturnSuccess()
    {
        var notifications = new Mock<INotificationService>();
        notifications
            .Setup(x => x.SendToAllAsync("Deploy complete", "info", It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);
        var service = new RealtimeGrpcService(notifications.Object, Mock.Of<ILogger<RealtimeGrpcService>>());

        var response = await service.BroadcastNotification(
            new BroadcastNotificationRequest
            {
                Message = "Deploy complete",
                Type = "info"
            },
            CreateContext("BroadcastNotification"));

        Assert.True(response.Success);
        notifications.Verify(
            x => x.SendToAllAsync("Deploy complete", "info", It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    [Trait("TestType", "Resilience")]
    [Trait("TestType", "Regression")]
    public async Task BroadcastNotification_ShouldPropagateNotificationServiceFailures()
    {
        var notifications = new Mock<INotificationService>();
        notifications
            .Setup(x => x.SendToAllAsync("Deploy failed", "error", It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("signalr down"));
        var service = new RealtimeGrpcService(notifications.Object, Mock.Of<ILogger<RealtimeGrpcService>>());

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.BroadcastNotification(
                new BroadcastNotificationRequest
                {
                    Message = "Deploy failed",
                    Type = "error"
                },
                CreateContext("BroadcastNotification")));
    }

    private static ServerCallContext CreateContext(string method)
        => TestServerCallContext.Create(
            method,
            null,
            DateTime.UtcNow.AddMinutes(1),
            new Metadata(),
            CancellationToken.None,
            "127.0.0.1",
            null,
            null,
            _ => Task.CompletedTask,
            () => null,
            _ => { });
}
