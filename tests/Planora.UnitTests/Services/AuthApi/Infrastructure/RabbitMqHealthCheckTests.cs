using Planora.Auth.Infrastructure.HealthChecks;
using Planora.BuildingBlocks.Infrastructure.Messaging;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Moq;
using RabbitMQ.Client;

namespace Planora.UnitTests.Services.AuthApi.Infrastructure;

public sealed class RabbitMqHealthCheckTests
{
    [Fact]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Regression")]
    public async Task CheckHealthAsync_ShouldReturnHealthyWhenRabbitConnectionIsOpen()
    {
        var connection = new Mock<IConnection>();
        connection.SetupGet(c => c.IsOpen).Returns(true);
        var manager = new Mock<IRabbitMqConnectionManager>();
        manager.Setup(m => m.GetConnectionAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(connection.Object);
        var healthCheck = new RabbitMqHealthCheck(manager.Object);

        var result = await healthCheck.CheckHealthAsync(new HealthCheckContext(), CancellationToken.None);

        Assert.Equal(HealthStatus.Healthy, result.Status);
        Assert.Equal("RabbitMQ connected", result.Description);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Regression")]
    public async Task CheckHealthAsync_ShouldReturnDegradedWhenConnectionIsClosedOrMissing(bool returnNull)
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

        var healthCheck = new RabbitMqHealthCheck(manager.Object);

        var result = await healthCheck.CheckHealthAsync(new HealthCheckContext(), CancellationToken.None);

        Assert.Equal(HealthStatus.Degraded, result.Status);
        Assert.Equal("RabbitMQ not connected", result.Description);
    }

    [Fact]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Regression")]
    public async Task CheckHealthAsync_ShouldReturnDegradedWhenConnectionManagerThrows()
    {
        var manager = new Mock<IRabbitMqConnectionManager>();
        manager.Setup(m => m.GetConnectionAsync(It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("broker unavailable"));
        var healthCheck = new RabbitMqHealthCheck(manager.Object);

        var result = await healthCheck.CheckHealthAsync(new HealthCheckContext(), CancellationToken.None);

        Assert.Equal(HealthStatus.Degraded, result.Status);
        Assert.Equal("RabbitMQ connection failed: broker unavailable", result.Description);
    }
}
