using Planora.Realtime.Infrastructure.Hubs;
using Planora.Realtime.Infrastructure.Services;
using Planora.Realtime.Infrastructure.SignalR;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Logging;
using Moq;

namespace Planora.UnitTests.Services.RealtimeApi.Infrastructure;

public class NotificationInfrastructureTests
{
    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "System")]
    [Trait("TestType", "Regression")]
    public async Task NotificationService_SendsToUserAllAndNamedGroup()
    {
        var userProxy = new Mock<IClientProxy>();
        var allProxy = new Mock<IClientProxy>();
        var groupProxy = new Mock<IClientProxy>();
        var clients = new Mock<IHubClients>();
        clients.Setup(x => x.Group("user:user-1")).Returns(userProxy.Object);
        clients.SetupGet(x => x.All).Returns(allProxy.Object);
        clients.Setup(x => x.Group("admins")).Returns(groupProxy.Object);
        var hubContext = new Mock<IHubContext<NotificationHub>>();
        hubContext.SetupGet(x => x.Clients).Returns(clients.Object);
        var service = new NotificationService(hubContext.Object, Mock.Of<ILogger<NotificationService>>());

        await service.SendNotificationAsync("user-1", "Personal", "info");
        await service.SendToAllAsync("Broadcast", "warning");
        await service.SendToGroupAsync("admins", "Grouped", "success");

        VerifyNotification(userProxy, "Personal", "info");
        VerifyNotification(allProxy, "Broadcast", "warning");
        VerifyNotification(groupProxy, "Grouped", "success");
    }

    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task NotificationService_PropagatesHubSendFailures()
    {
        var userProxy = new Mock<IClientProxy>();
        userProxy
            .Setup(x => x.SendCoreAsync("ReceiveNotification", It.IsAny<object?[]>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("user hub down"));
        var allProxy = new Mock<IClientProxy>();
        allProxy
            .Setup(x => x.SendCoreAsync("ReceiveNotification", It.IsAny<object?[]>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("broadcast hub down"));
        var groupProxy = new Mock<IClientProxy>();
        groupProxy
            .Setup(x => x.SendCoreAsync("ReceiveNotification", It.IsAny<object?[]>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("group hub down"));
        var clients = new Mock<IHubClients>();
        clients.Setup(x => x.Group("user:user-1")).Returns(userProxy.Object);
        clients.SetupGet(x => x.All).Returns(allProxy.Object);
        clients.Setup(x => x.Group("admins")).Returns(groupProxy.Object);
        var hubContext = new Mock<IHubContext<NotificationHub>>();
        hubContext.SetupGet(x => x.Clients).Returns(clients.Object);
        var service = new NotificationService(hubContext.Object, Mock.Of<ILogger<NotificationService>>());

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.SendNotificationAsync("user-1", "Personal", "info"));
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.SendToAllAsync("Broadcast", "warning"));
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.SendToGroupAsync("admins", "Grouped", "success"));
    }

    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task AuthNotificationService_EmitsExpectedAuthEventsToUserGroup()
    {
        var proxy = new Mock<IClientProxy>();
        var clients = new Mock<IHubClients>();
        var hubContext = new Mock<IHubContext<NotificationHub>>();
        var userId = Guid.NewGuid();
        clients.Setup(x => x.Group($"user:{userId}")).Returns(proxy.Object);
        hubContext.SetupGet(x => x.Clients).Returns(clients.Object);
        var service = new AuthNotificationService(hubContext.Object, Mock.Of<ILogger<AuthNotificationService>>());

        await service.NotifyNewLoginAsync(userId, "Chrome", "Moscow");
        await service.NotifyPasswordChangedAsync(userId);
        await service.NotifyAccountLockedAsync(userId, DateTime.UtcNow.AddMinutes(15));
        await service.NotifyForceLogoutAsync(userId, "admin action");
        await service.NotifySuspiciousActivityAsync(userId, "new country");

        foreach (var method in new[]
                 {
                     "NewLogin",
                     "PasswordChanged",
                     "AccountLocked",
                     "ForceLogout",
                     "SuspiciousActivity"
                 })
        {
            proxy.Verify(
                x => x.SendCoreAsync(method, It.Is<object?[]>(args => args.Length == 1), It.IsAny<CancellationToken>()),
                Times.Once);
        }
    }

    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "System")]
    [Trait("TestType", "Regression")]
    public async Task NotificationHub_TracksUserGroupMembershipAndSubscriptions()
    {
        var groups = new Mock<IGroupManager>();
        var connectionManager = new Mock<IConnectionManager>();
        var hub = new NotificationHub(Mock.Of<ILogger<NotificationHub>>(), connectionManager.Object)
        {
            Context = HubContext("user-1", "conn-1"),
            Groups = groups.Object
        };

        await hub.OnConnectedAsync();
        await hub.Subscribe("announcements");
        await hub.Unsubscribe("announcements");
        await hub.OnDisconnectedAsync(null);

        groups.Verify(x => x.AddToGroupAsync("conn-1", "user:user-1", It.IsAny<CancellationToken>()), Times.Once);
        groups.Verify(x => x.RemoveFromGroupAsync("conn-1", "user:user-1", It.IsAny<CancellationToken>()), Times.Once);
        groups.Verify(x => x.AddToGroupAsync("conn-1", "announcements", It.IsAny<CancellationToken>()), Times.Once);
        groups.Verify(x => x.RemoveFromGroupAsync("conn-1", "announcements", It.IsAny<CancellationToken>()), Times.Once);
        connectionManager.Verify(x => x.AddConnectionAsync("user-1", "conn-1"), Times.Once);
        connectionManager.Verify(x => x.RemoveConnectionAsync("user-1", "conn-1"), Times.Once);
    }

    [Fact]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public async Task NotificationHub_RejectsSubscriptionToDisallowedTopics()
    {
        var groups = new Mock<IGroupManager>();
        var connectionManager = new Mock<IConnectionManager>();
        var hub = new NotificationHub(Mock.Of<ILogger<NotificationHub>>(), connectionManager.Object)
        {
            Context = HubContext("user-1", "conn-1"),
            Groups = groups.Object
        };

        // Attempt to subscribe to arbitrary topics including a user group of another user
        await hub.Subscribe("user:user-2");
        await hub.Subscribe("admin");
        await hub.Subscribe("*");

        // None of the disallowed topics should result in a group add
        groups.Verify(
            x => x.AddToGroupAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public async Task NotificationHub_DoesNotTrackAnonymousConnections()
    {
        var groups = new Mock<IGroupManager>();
        var connectionManager = new Mock<IConnectionManager>();
        var hub = new NotificationHub(Mock.Of<ILogger<NotificationHub>>(), connectionManager.Object)
        {
            Context = HubContext(userId: null, connectionId: "conn-anon"),
            Groups = groups.Object
        };

        await hub.OnConnectedAsync();
        await hub.OnDisconnectedAsync(null);

        groups.VerifyNoOtherCalls();
        connectionManager.VerifyNoOtherCalls();
    }

    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "System")]
    [Trait("TestType", "Regression")]
    public async Task TodoHub_ConnectsUsersAndBroadcastsTodoEvents()
    {
        var groups = new Mock<IGroupManager>();
        var proxy = new Mock<IClientProxy>();
        var clients = new Mock<IHubCallerClients>();
        clients.Setup(x => x.Group("todos:user-1")).Returns(proxy.Object);
        var hub = new TodoHub(Mock.Of<ILogger<TodoHub>>())
        {
            Context = HubContext("user-1", "conn-1"),
            Groups = groups.Object,
            Clients = clients.Object
        };
        var todo = new { id = "todo-1" };
        var todoId = Guid.NewGuid();

        await hub.OnConnectedAsync();
        await hub.NotifyTodoCreated("user-1", todo);
        await hub.NotifyTodoUpdated("user-1", todo);
        await hub.NotifyTodoDeleted("user-1", todoId);

        groups.Verify(x => x.AddToGroupAsync("conn-1", "todos:user-1", It.IsAny<CancellationToken>()), Times.Once);
        proxy.Verify(x => x.SendCoreAsync("TodoCreated", It.Is<object?[]>(args => ReferenceEquals(args[0], todo)), It.IsAny<CancellationToken>()), Times.Once);
        proxy.Verify(x => x.SendCoreAsync("TodoUpdated", It.Is<object?[]>(args => ReferenceEquals(args[0], todo)), It.IsAny<CancellationToken>()), Times.Once);
        proxy.Verify(x => x.SendCoreAsync("TodoDeleted", It.Is<object?[]>(args => Equals(args[0], todoId)), It.IsAny<CancellationToken>()), Times.Once);
    }

    private static void VerifyNotification(Mock<IClientProxy> proxy, string message, string type)
    {
        proxy.Verify(
            x => x.SendCoreAsync(
                "ReceiveNotification",
                It.Is<object?[]>(args => args.Length == 1
                    && args[0]!.ToString()!.Contains(message, StringComparison.Ordinal)
                    && args[0]!.ToString()!.Contains(type, StringComparison.Ordinal)),
                It.IsAny<CancellationToken>()),
            Times.Once);
    }

    private static HubCallerContext HubContext(string? userId, string connectionId)
    {
        var context = new Mock<HubCallerContext>();
        context.SetupGet(x => x.UserIdentifier).Returns(userId);
        context.SetupGet(x => x.ConnectionId).Returns(connectionId);
        return context.Object;
    }
}
