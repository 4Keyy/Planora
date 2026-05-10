using System.Security.Claims;
using Planora.Realtime.Api.Hubs;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Logging;
using Moq;

namespace Planora.UnitTests.Services.RealtimeApi.Hubs;

public sealed class PresenceHubTests
{
    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "System")]
    [Trait("TestType", "Regression")]
    public async Task PresenceHub_ShouldBroadcastConnectDisconnectAndStatusForAuthenticatedUser()
    {
        var others = new Mock<IClientProxy>();
        var clients = new Mock<IHubCallerClients>();
        clients.SetupGet(x => x.Others).Returns(others.Object);
        var hub = new PresenceHub(Mock.Of<ILogger<PresenceHub>>())
        {
            Context = CreateContext("user-1"),
            Clients = clients.Object
        };

        await hub.OnConnectedAsync();
        await hub.UpdateStatus("busy");
        await hub.OnDisconnectedAsync(new InvalidOperationException("disconnect"));

        VerifySend(others, "UserConnected", "user-1");
        VerifySend(others, "UserStatusChanged", "user-1", "busy");
        VerifySend(others, "UserDisconnected", "user-1");
    }

    [Fact]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public async Task PresenceHub_ShouldNotBroadcastForAnonymousUser()
    {
        var others = new Mock<IClientProxy>();
        var clients = new Mock<IHubCallerClients>();
        clients.SetupGet(x => x.Others).Returns(others.Object);
        var hub = new PresenceHub(Mock.Of<ILogger<PresenceHub>>())
        {
            Context = CreateContext(null),
            Clients = clients.Object
        };

        await hub.OnConnectedAsync();
        await hub.UpdateStatus("busy");
        await hub.OnDisconnectedAsync(null);

        others.VerifyNoOtherCalls();
    }

    private static HubCallerContext CreateContext(string? userId)
    {
        var context = new Mock<HubCallerContext>();
        var identity = userId is null
            ? new ClaimsIdentity()
            : new ClaimsIdentity(new[] { new Claim("sub", userId) }, "test");
        context.SetupGet(x => x.User).Returns(new ClaimsPrincipal(identity));
        return context.Object;
    }

    private static void VerifySend(Mock<IClientProxy> proxy, string method, params object[] expectedArgs)
    {
        proxy.Verify(
            x => x.SendCoreAsync(
                method,
                It.Is<object?[]>(args => expectedArgs.SequenceEqual(args!)),
                It.IsAny<CancellationToken>()),
            Times.Once);
    }
}
