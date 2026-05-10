using Planora.Auth.Infrastructure.Services.Messaging;
using Planora.BuildingBlocks.Infrastructure.Messaging;
using Microsoft.Extensions.Logging;
using Moq;
using RabbitMQ.Client;

namespace Planora.UnitTests.Services.AuthApi.Infrastructure;

public sealed class RabbitMqStartupHostedServiceTests
{
    [Fact]
    [Trait("TestType", "System")]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Regression")]
    public async Task StartAndStopAsync_ShouldProbeOpenRabbitConnectionAndStopCleanly()
    {
        var connection = new Mock<IConnection>();
        connection.SetupGet(c => c.IsOpen).Returns(true);
        var manager = new Mock<IRabbitMqConnectionManager>();
        manager.Setup(m => m.GetConnectionAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(connection.Object);
        var service = CreateService(manager);

        await service.StartAsync(CancellationToken.None);
        await service.StopAsync(CancellationToken.None);

        manager.Verify(m => m.GetConnectionAsync(It.IsAny<CancellationToken>()), Times.AtLeastOnce);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    [Trait("TestType", "System")]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Regression")]
    public async Task StartAndStopAsync_ShouldContinueWhenRabbitConnectionIsMissingOrClosed(bool returnNull)
    {
        var manager = new Mock<IRabbitMqConnectionManager>();
        if (returnNull)
        {
            manager.Setup(m => m.GetConnectionAsync(It.IsAny<CancellationToken>()))
                .ReturnsAsync((IConnection)null!);
        }
        else
        {
            var connection = new Mock<IConnection>();
            connection.SetupGet(c => c.IsOpen).Returns(false);
            manager.Setup(m => m.GetConnectionAsync(It.IsAny<CancellationToken>()))
                .ReturnsAsync(connection.Object);
        }

        var service = CreateService(manager);

        await service.StartAsync(CancellationToken.None);
        await service.StopAsync(CancellationToken.None);

        manager.Verify(m => m.GetConnectionAsync(It.IsAny<CancellationToken>()), Times.AtLeastOnce);
    }

    [Fact]
    [Trait("TestType", "System")]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Regression")]
    public async Task StartAndStopAsync_ShouldContinueWhenConnectionAttemptThrows()
    {
        var manager = new Mock<IRabbitMqConnectionManager>();
        manager.Setup(m => m.GetConnectionAsync(It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("connection refused"));
        var service = CreateService(manager);

        await service.StartAsync(CancellationToken.None);
        await service.StopAsync(CancellationToken.None);

        manager.Verify(m => m.GetConnectionAsync(It.IsAny<CancellationToken>()), Times.AtLeastOnce);
    }

    [Fact]
    [Trait("TestType", "System")]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Regression")]
    public async Task StartAndStopAsync_ShouldRetryAfterTimerTick_WhenRetryIntervalIsShortened()
    {
        var attempts = 0;
        var retried = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var connection = new Mock<IConnection>();
        connection.SetupGet(c => c.IsOpen).Returns(true);
        var manager = new Mock<IRabbitMqConnectionManager>();
        manager
            .Setup(m => m.GetConnectionAsync(It.IsAny<CancellationToken>()))
            .Callback(() =>
            {
                if (Interlocked.Increment(ref attempts) >= 2)
                    retried.TrySetResult();
            })
            .ReturnsAsync(connection.Object);
        var service = CreateService(manager);
        typeof(RabbitMqStartupHostedService)
            .GetField("_retryInterval", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)!
            .SetValue(service, TimeSpan.FromMilliseconds(10));

        await service.StartAsync(CancellationToken.None);
        var completed = await Task.WhenAny(retried.Task, Task.Delay(TimeSpan.FromSeconds(2)));
        await service.StopAsync(CancellationToken.None);

        Assert.Same(retried.Task, completed);
        Assert.True(attempts >= 2);
    }

    [Fact]
    [Trait("TestType", "System")]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Regression")]
    public async Task ExecuteAsync_ShouldExitLoopCleanly_WhenTokenIsAlreadyCanceled()
    {
        var connection = new Mock<IConnection>();
        connection.SetupGet(c => c.IsOpen).Returns(true);
        var manager = new Mock<IRabbitMqConnectionManager>();
        manager
            .Setup(m => m.GetConnectionAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(connection.Object);
        var service = CreateService(manager);
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();
        var executeAsync = typeof(RabbitMqStartupHostedService)
            .GetMethod("ExecuteAsync", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)!;

        await (Task)executeAsync.Invoke(service, new object[] { cancellation.Token })!;

        manager.Verify(m => m.GetConnectionAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    private static RabbitMqStartupHostedService CreateService(Mock<IRabbitMqConnectionManager> manager) =>
        new(manager.Object, Mock.Of<ILogger<RabbitMqStartupHostedService>>());
}
