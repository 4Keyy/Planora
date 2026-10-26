using System.Text.Json;
using Planora.Realtime.Application.Response;
using Planora.Realtime.Infrastructure.Hubs;
using Planora.Realtime.Infrastructure.Services;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Logging;
using Moq;

namespace Planora.UnitTests.Services.RealtimeApi.Infrastructure;

/// <summary>
/// Every <c>ReceiveNotification</c> push has the client's <c>NotificationPayload</c> shape
/// (FE-11, API-10), however it was sent.
/// </summary>
public sealed class NotificationWireShapeTests
{
    private static readonly string[] ClientFields =
        ["id", "userId", "taskId", "actorId", "type", "title", "message", "occurredOnUtc", "isRead"];

    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task EverySender_PushesTheSameShape()
    {
        var sent = new List<JsonElement>();
        var service = Service(sent);
        var userId = Guid.NewGuid();
        var taskId = Guid.NewGuid();
        var at = new DateTime(2026, 10, 26, 9, 0, 0, DateTimeKind.Utc);

        await service.SendToUserAsync(new NotificationPayload(Guid.NewGuid(), userId, taskId, Guid.NewGuid(), "comment.added", "Ada commented", "Looks good", at, false));
        await service.SendNotificationAsync(userId.ToString(), "Maintenance tonight", "info");
        await service.SendToAllAsync("Back online", "success");
        await service.SendToGroupAsync("admins", "Disk almost full", "warning");

        Assert.Equal(4, sent.Count);
        foreach (var push in sent)
            Assert.Equal(ClientFields, push.EnumerateObject().Select(p => p.Name).ToArray());

        Assert.Equal(at, sent[0].GetProperty("occurredOnUtc").GetDateTime());
        Assert.Equal(taskId, sent[0].GetProperty("taskId").GetGuid());
        Assert.Equal("Ada commented", sent[0].GetProperty("title").GetString());
    }

    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task AdHocNotifications_HaveATitleAndNoTask()
    {
        var sent = new List<JsonElement>();
        var service = Service(sent);
        var userId = Guid.NewGuid();

        await service.SendNotificationAsync(userId.ToString(), "Maintenance tonight", "info");
        await service.SendToAllAsync("Back online", "success");

        var personal = sent[0];
        Assert.Equal("Maintenance tonight", personal.GetProperty("title").GetString());
        Assert.Equal("info", personal.GetProperty("type").GetString());
        Assert.Equal(userId, personal.GetProperty("userId").GetGuid());
        Assert.Equal(Guid.Empty, personal.GetProperty("taskId").GetGuid());
        Assert.Equal(Guid.Empty, personal.GetProperty("actorId").GetGuid());
        Assert.False(personal.GetProperty("isRead").GetBoolean());
        Assert.NotEqual(Guid.Empty, personal.GetProperty("id").GetGuid());
        Assert.Equal(Guid.Empty, sent[1].GetProperty("userId").GetGuid());
    }

    /// <summary>A service whose pushes are captured as the JSON SignalR would write.</summary>
    private static NotificationService Service(List<JsonElement> sent)
    {
        var proxy = new Mock<IClientProxy>();
        proxy
            .Setup(x => x.SendCoreAsync("ReceiveNotification", It.IsAny<object?[]>(), It.IsAny<CancellationToken>()))
            .Callback<string, object?[], CancellationToken>((_, args, _) =>
                sent.Add(JsonSerializer.SerializeToElement(args[0], new JsonSerializerOptions(JsonSerializerDefaults.Web))))
            .Returns(Task.CompletedTask);
        var clients = new Mock<IHubClients>();
        clients.Setup(x => x.Group(It.IsAny<string>())).Returns(proxy.Object);
        clients.SetupGet(x => x.All).Returns(proxy.Object);
        var hub = new Mock<IHubContext<NotificationHub>>();
        hub.SetupGet(x => x.Clients).Returns(clients.Object);
        return new NotificationService(hub.Object, Mock.Of<ILogger<NotificationService>>());
    }
}
