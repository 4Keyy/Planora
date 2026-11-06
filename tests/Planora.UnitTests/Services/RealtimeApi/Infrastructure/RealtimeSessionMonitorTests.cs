using System.Collections.Concurrent;
using System.Globalization;
using System.Security.Claims;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Moq;
using Planora.BuildingBlocks.Infrastructure.Security;
using Planora.Realtime.Infrastructure.Hubs;
using Planora.Realtime.Infrastructure.Services;
using Planora.Realtime.Application.Interfaces;
using StackExchange.Redis;

namespace Planora.UnitTests.Services.RealtimeApi.Infrastructure;

public sealed class RealtimeSessionMonitorTests
{
    [Fact]
    [Trait("TestType", "Security")]
    public async Task IdleConnection_AfterStampRotation_IsAbortedAndRemovedOnNextTick()
    {
        var now = DateTimeOffset.UtcNow;
        var user = Guid.NewGuid();
        var task = Guid.NewGuid();
        RedisValue stamp = RedisValue.Null;
        var database = Database(() => stamp);
        var manager = new ConnectionManager(Mock.Of<ILogger<ConnectionManager>>());
        var groups = new Mock<IGroupManager>();
        var hubContext = Mock.Of<IHubContext<NotificationHub>>(x => x.Groups == groups.Object);
        var monitor = CreateMonitor(database: database.Object, manager: manager, hubContext: hubContext);
        var caller = Context(user, now.AddMinutes(-5), now.AddMinutes(10));
        var joined = new ConcurrentDictionary<string, byte>();
        joined.TryAdd(task.ToString(), 0);
        caller.Object.Items["joined-tasks"] = joined;
        await manager.AddConnectionAsync(user.ToString(), "connection");
        monitor.Register(caller.Object);
        stamp = now.UtcDateTime.ToString("O", CultureInfo.InvariantCulture);

        await monitor.RevalidateConnectionsAsync();

        caller.Verify(x => x.Abort(), Times.Once);
        Assert.Equal(0, monitor.TrackedConnectionCount);
        Assert.Empty(manager.GetUserConnections(user.ToString()));
        Assert.Empty(joined);
        groups.Verify(x => x.RemoveFromGroupAsync("connection", $"user:{user}", It.IsAny<CancellationToken>()), Times.Once);
        groups.Verify(x => x.RemoveFromGroupAsync("connection", $"task:{task}:user:{user}", It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    [Trait("TestType", "Security")]
    public async Task IdleConnection_WhenRedisFails_IsAbortedOnNextTick()
    {
        var database = new Mock<IDatabase>();
        database.Setup(x => x.StringGetAsync(It.IsAny<RedisKey>(), It.IsAny<CommandFlags>()))
            .ThrowsAsync(new RedisConnectionException(ConnectionFailureType.UnableToConnect, "test outage"));
        var monitor = CreateMonitor(database: database.Object);
        var caller = Context(Guid.NewGuid(), DateTimeOffset.UtcNow.AddMinutes(-5), DateTimeOffset.UtcNow.AddMinutes(10));
        monitor.Register(caller.Object);

        await monitor.RevalidateConnectionsAsync();

        caller.Verify(x => x.Abort(), Times.Once);
        Assert.Equal(0, monitor.TrackedConnectionCount);
    }

    [Fact]
    [Trait("TestType", "Resilience")]
    public async Task IdleConnection_WhenBackplaneCleanupAlsoFails_StillAbortsAndUnregisters()
    {
        var now = DateTimeOffset.UtcNow;
        var database = Database(() => now.UtcDateTime.ToString("O", CultureInfo.InvariantCulture));
        var groups = new Mock<IGroupManager>();
        groups.Setup(x => x.RemoveFromGroupAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new RedisConnectionException(ConnectionFailureType.UnableToConnect, "test outage"));
        var monitor = CreateMonitor(database: database.Object,
            hubContext: Mock.Of<IHubContext<NotificationHub>>(x => x.Groups == groups.Object));
        var caller = Context(Guid.NewGuid(), now.AddMinutes(-5), now.AddMinutes(10));
        monitor.Register(caller.Object);

        await monitor.RevalidateConnectionsAsync();

        caller.Verify(x => x.Abort(), Times.Once);
        Assert.Equal(0, monitor.TrackedConnectionCount);
    }

    [Fact]
    [Trait("TestType", "Resilience")]
    public async Task CancelledTick_PropagatesCancellationWithoutRevokingHealthyConnections()
    {
        using var source = new CancellationTokenSource();
        source.Cancel();
        var monitor = CreateMonitor();
        var caller = Context(Guid.NewGuid(), DateTimeOffset.UtcNow.AddMinutes(-1), DateTimeOffset.UtcNow.AddMinutes(10));
        monitor.Register(caller.Object);

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => monitor.RevalidateConnectionsAsync(source.Token));

        caller.Verify(x => x.Abort(), Times.Never);
        Assert.Equal(1, monitor.TrackedConnectionCount);
    }

    [Fact]
    [Trait("TestType", "Security")]
    public async Task IdleConnection_WhenTokenExpires_IsAbortedUsingInjectedClock()
    {
        var now = DateTimeOffset.UtcNow;
        var clock = new SessionClock(now);
        var database = Database(() => RedisValue.Null);
        var monitor = CreateMonitor(database: database.Object, timeProvider: clock);
        var caller = Context(Guid.NewGuid(), now.AddMinutes(-1), now.AddSeconds(5));
        monitor.Register(caller.Object);
        clock.Now = now.AddSeconds(6);

        await monitor.RevalidateConnectionsAsync();

        caller.Verify(x => x.Abort(), Times.Once);
        Assert.Equal(0, monitor.TrackedConnectionCount);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    public async Task IdleConnection_WithCurrentToken_IsKeptAndDisconnectRemovesRegistration()
    {
        var now = DateTimeOffset.UtcNow;
        var database = Database(() => RedisValue.Null);
        var monitor = CreateMonitor(database: database.Object);
        var caller = Context(Guid.NewGuid(), now.AddMinutes(-1), now.AddMinutes(10));
        monitor.Register(caller.Object);

        await monitor.RevalidateConnectionsAsync();

        caller.Verify(x => x.Abort(), Times.Never);
        Assert.Equal(1, monitor.TrackedConnectionCount);
        monitor.Unregister(caller.Object.ConnectionId);
        Assert.Equal(0, monitor.TrackedConnectionCount);
    }

    [Fact]
    public void RevalidationInterval_IsFifteenSeconds() =>
        Assert.Equal(TimeSpan.FromSeconds(15), RealtimeSessionMonitor.RevalidationInterval);

    [Fact]
    [Trait("TestType", "Security")]
    public async Task Token_ExpiringDuringRedisLookup_IsRejected()
    {
        var now = DateTimeOffset.UtcNow;
        var clock = new SessionClock(now);
        var database = Database(() =>
        {
            clock.Now = now.AddSeconds(6);
            return RedisValue.Null;
        });
        var monitor = CreateMonitor(database: database.Object, timeProvider: clock);
        var caller = Context(Guid.NewGuid(), now.AddMinutes(-1), now.AddSeconds(5));

        Assert.False(await monitor.ValidateAsync(caller.Object));

        caller.Verify(x => x.Abort(), Times.Once);
    }

    [Theory]
    [InlineData("join")]
    [InlineData("start")]
    [InlineData("stop")]
    [Trait("TestType", "Security")]
    public async Task ActiveInvocation_AfterStampRotation_IsRejectedBeforeCallingTodo(string operation)
    {
        var now = DateTimeOffset.UtcNow;
        var user = Guid.NewGuid();
        var task = Guid.NewGuid();
        RedisValue stamp = RedisValue.Null;
        var monitor = CreateMonitor(database: Database(() => stamp).Object);
        var caller = Context(user, now.AddMinutes(-5), now.AddMinutes(10));
        var authorizer = new Mock<ITaskBranchAuthorizer>();
        authorizer.Setup(x => x.CanAccessBranchAsync(task, user, It.IsAny<CancellationToken>())).ReturnsAsync(true);
        authorizer.Setup(x => x.GetAudienceAsync(task, user, It.IsAny<CancellationToken>())).ReturnsAsync(new[] { user });
        var hub = CreateHub(caller.Object, monitor, authorizer.Object);
        await hub.OnConnectedAsync();
        if (operation != "join") await hub.JoinTask(task.ToString());
        authorizer.Invocations.Clear();
        stamp = now.UtcDateTime.ToString("O", CultureInfo.InvariantCulture);

        if (operation == "join") await hub.JoinTask(task.ToString());
        else if (operation == "start") await hub.StartTyping(task.ToString());
        else await hub.StopTyping(task.ToString());

        caller.Verify(x => x.Abort(), Times.Once);
        authorizer.VerifyNoOtherCalls();
        Assert.Equal(0, monitor.TrackedConnectionCount);
        Mock.Get(hub.Clients).VerifyNoOtherCalls();
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    [Trait("TestType", "Security")]
    public async Task ActiveInvocation_WhenStampRotatesDuringTodoRpc_IsRejectedAfterRpc(bool typing)
    {
        var now = DateTimeOffset.UtcNow;
        var user = Guid.NewGuid();
        var task = Guid.NewGuid();
        RedisValue stamp = RedisValue.Null;
        var monitor = CreateMonitor(database: Database(() => stamp).Object);
        var caller = Context(user, now.AddMinutes(-5), now.AddMinutes(10));
        var authorizer = new Mock<ITaskBranchAuthorizer>();
        authorizer.Setup(x => x.CanAccessBranchAsync(task, user, It.IsAny<CancellationToken>())).ReturnsAsync(true);
        var hub = CreateHub(caller.Object, monitor, authorizer.Object);
        await hub.OnConnectedAsync();
        if (typing)
        {
            await hub.JoinTask(task.ToString());
            authorizer.Setup(x => x.GetAudienceAsync(task, user, It.IsAny<CancellationToken>()))
                .Callback(() => stamp = now.UtcDateTime.ToString("O", CultureInfo.InvariantCulture))
                .ReturnsAsync(new[] { user });
        }
        else
            authorizer.Setup(x => x.CanAccessBranchAsync(task, user, It.IsAny<CancellationToken>()))
                .Callback(() => stamp = now.UtcDateTime.ToString("O", CultureInfo.InvariantCulture)).ReturnsAsync(true);
        Mock.Get(hub.Groups).Invocations.Clear();

        if (typing) await hub.StartTyping(task.ToString());
        else await hub.JoinTask(task.ToString());

        caller.Verify(x => x.Abort(), Times.Once);
        Mock.Get(hub.Clients).VerifyNoOtherCalls();
        Mock.Get(hub.Groups).Verify(x => x.AddToGroupAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
        Assert.Equal(0, monitor.TrackedConnectionCount);
    }

    [Fact]
    public void Infrastructure_RegistersTheSameMonitorAsSingletonAndHostedService()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSignalR();
        var redis = new Mock<IConnectionMultiplexer>();
        redis.Setup(x => x.GetDatabase(It.IsAny<int>(), It.IsAny<object>())).Returns(Database(() => RedisValue.Null).Object);
        services.AddSingleton(redis.Object);
        Planora.Realtime.Infrastructure.DependencyInjection.AddRealtimeInfrastructure(services,
            new ConfigurationBuilder().Build());
        using var provider = services.BuildServiceProvider();

        var monitor = provider.GetRequiredService<RealtimeSessionMonitor>();

        Assert.Same(monitor, Assert.Single(provider.GetServices<IHostedService>(), service => service is RealtimeSessionMonitor));
    }

    private static NotificationHub CreateHub(HubCallerContext context, RealtimeSessionMonitor monitor,
        ITaskBranchAuthorizer authorizer) => new(Mock.Of<ILogger<NotificationHub>>(),
            new ConnectionManager(Mock.Of<ILogger<ConnectionManager>>()), authorizer, monitor)
        {
            Context = context, Groups = Mock.Of<IGroupManager>(), Clients = Mock.Of<IHubCallerClients>(),
        };

    internal static RealtimeSessionMonitor CreateMonitor(IDatabase? database = null,
        IConnectionManager? manager = null, TimeProvider? timeProvider = null,
        IHubContext<NotificationHub>? hubContext = null)
    {
        database ??= Database(() => RedisValue.Null).Object;
        var redis = new Mock<IConnectionMultiplexer>();
        redis.Setup(x => x.GetDatabase(It.IsAny<int>(), It.IsAny<object>())).Returns(database);
        hubContext ??= Mock.Of<IHubContext<NotificationHub>>(x => x.Groups == Mock.Of<IGroupManager>());
        return new RealtimeSessionMonitor(redis.Object,
            manager ?? new ConnectionManager(Mock.Of<ILogger<ConnectionManager>>()), hubContext,
            timeProvider ?? TimeProvider.System, Mock.Of<ILogger<RealtimeSessionMonitor>>());
    }

    internal static Mock<IDatabase> Database(Func<RedisValue> value)
    {
        var database = new Mock<IDatabase>();
        database.Setup(x => x.StringGetAsync(It.IsAny<RedisKey>(), It.IsAny<CommandFlags>()))
            .ReturnsAsync(value);
        return database;
    }

    internal static Mock<HubCallerContext> Context(Guid user, DateTimeOffset issued, DateTimeOffset expires)
    {
        var context = new Mock<HubCallerContext>();
        context.SetupGet(x => x.ConnectionId).Returns("connection");
        context.SetupGet(x => x.UserIdentifier).Returns(user.ToString());
        context.SetupGet(x => x.User).Returns(Principal(user, issued, expires));
        context.SetupGet(x => x.Items).Returns(new Dictionary<object, object?>());
        return context;
    }

    internal static ClaimsPrincipal Principal(Guid user, DateTimeOffset issued, DateTimeOffset expires) =>
        new(new ClaimsIdentity(new[]
        {
            new Claim(ClaimTypes.NameIdentifier, user.ToString()),
            new Claim("iat", issued.ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture)),
            new Claim("exp", expires.ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture)),
        }, "Bearer"));

    private sealed class SessionClock(DateTimeOffset now) : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = now;
        public override DateTimeOffset GetUtcNow() => Now;
    }
}
