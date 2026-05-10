using Planora.Realtime.Infrastructure.Services;
using Microsoft.Extensions.Logging;
using Moq;

namespace Planora.UnitTests.Services.RealtimeApi.Infrastructure;

public class ConnectionManagerTests
{
    [Fact]
    [Trait("TestType", "System")]
    [Trait("TestType", "Functional")]
    public async Task ConnectionManager_ShouldTrackMultipleConnectionsAndCleanupEmptyUsers()
    {
        var manager = new ConnectionManager(Mock.Of<ILogger<ConnectionManager>>());

        await manager.AddConnectionAsync("user-1", "conn-1");
        await manager.AddConnectionAsync("user-1", "conn-2");
        await manager.AddConnectionAsync("user-2", "conn-3");
        await manager.AddConnectionAsync("user-1", "conn-1");

        Assert.Equal(3, manager.GetTotalConnections());
        Assert.Equal(new[] { "conn-1", "conn-2" }.OrderBy(x => x), manager.GetUserConnections("user-1").OrderBy(x => x));

        await manager.RemoveConnectionAsync("user-1", "conn-1");
        Assert.Single(manager.GetUserConnections("user-1"));
        Assert.Equal(2, manager.GetTotalConnections());

        await manager.RemoveConnectionAsync("user-1", "conn-2");
        Assert.Empty(manager.GetUserConnections("user-1"));
        Assert.Equal(1, manager.GetTotalConnections());

        await manager.RemoveConnectionAsync("missing", "conn");
        Assert.Equal(1, manager.GetTotalConnections());
    }

    [Fact]
    [Trait("TestType", "Load")]
    [Trait("TestType", "Regression")]
    public async Task ConnectionManager_ShouldHandleConcurrentConnectAndDisconnectBursts()
    {
        var manager = new ConnectionManager(Mock.Of<ILogger<ConnectionManager>>());
        const int users = 25;
        const int connectionsPerUser = 20;
        var adds = Enumerable.Range(0, users)
            .SelectMany(userIndex => Enumerable.Range(0, connectionsPerUser)
                .Select(connectionIndex => manager.AddConnectionAsync(
                    $"user-{userIndex}",
                    $"conn-{userIndex}-{connectionIndex}")))
            .ToArray();

        await Task.WhenAll(adds);

        Assert.Equal(users * connectionsPerUser, manager.GetTotalConnections());
        for (var userIndex = 0; userIndex < users; userIndex++)
        {
            Assert.Equal(connectionsPerUser, manager.GetUserConnections($"user-{userIndex}").Count);
        }

        var removes = Enumerable.Range(0, users)
            .SelectMany(userIndex => Enumerable.Range(0, connectionsPerUser)
                .Select(connectionIndex => manager.RemoveConnectionAsync(
                    $"user-{userIndex}",
                    $"conn-{userIndex}-{connectionIndex}")))
            .ToArray();

        await Task.WhenAll(removes);

        Assert.Equal(0, manager.GetTotalConnections());
        Assert.Empty(manager.GetUserConnections("user-0"));
    }
}
