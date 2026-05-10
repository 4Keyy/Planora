using System.Security.Claims;
using Planora.Realtime.Api.Controllers;
using Planora.Realtime.Application.Response;
using Planora.Realtime.Infrastructure.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using Moq;

namespace Planora.UnitTests.Services.RealtimeApi.Controllers;

public class ConnectionsControllerTests
{
    [Fact]
    [Trait("TestType", "System")]
    [Trait("TestType", "Functional")]
    public void GetActiveConnections_ShouldReturnCurrentUsersConnections()
    {
        var connectionManager = new Mock<IConnectionManager>();
        connectionManager
            .Setup(x => x.GetUserConnections("user-123"))
            .Returns(new List<string> { "conn-1", "conn-2" });
        var controller = CreateController(connectionManager.Object, "user-123");

        var response = Assert.IsType<OkObjectResult>(controller.GetActiveConnections());
        var payload = Assert.IsType<ActiveConnectionsResponse>(response.Value);

        Assert.Equal("user-123", payload.UserId);
        Assert.Equal(2, payload.ConnectionCount);
        Assert.Equal(new[] { "conn-1", "conn-2" }, payload.Connections.Select(x => x.ConnectionId));
    }

    [Fact]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public void GetActiveConnections_ShouldRejectMissingSubjectClaim()
    {
        var controller = CreateController(Mock.Of<IConnectionManager>(), userId: null);

        var response = Assert.IsType<UnauthorizedObjectResult>(controller.GetActiveConnections());

        Assert.Contains("USER_NOT_AUTHENTICATED", response.Value!.ToString(), StringComparison.Ordinal);
    }

    [Fact]
    [Trait("TestType", "System")]
    [Trait("TestType", "Acceptance")]
    public void GetStats_ShouldReturnTotalConnections()
    {
        var connectionManager = new Mock<IConnectionManager>();
        connectionManager.Setup(x => x.GetTotalConnections()).Returns(42);
        var controller = CreateController(connectionManager.Object, "admin-1");

        var response = Assert.IsType<OkObjectResult>(controller.GetStats());
        var payload = Assert.IsType<ConnectionStatsResponse>(response.Value);

        Assert.Equal(42, payload.TotalConnections);
        Assert.True(payload.Timestamp <= DateTime.UtcNow);
    }

    private static ConnectionsController CreateController(IConnectionManager connectionManager, string? userId)
    {
        var controller = new ConnectionsController(
            connectionManager,
            Mock.Of<ILogger<ConnectionsController>>());

        var identity = userId is null
            ? new ClaimsIdentity()
            : new ClaimsIdentity(new[] { new Claim("sub", userId) }, "test");

        controller.ControllerContext = new ControllerContext
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(identity)
            }
        };

        return controller;
    }
}
