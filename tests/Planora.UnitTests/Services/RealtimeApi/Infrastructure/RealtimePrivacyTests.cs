using System.Security.Claims;
using System.Text.RegularExpressions;
using Grpc.Core;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Moq;
using Planora.GrpcContracts;
using Planora.Realtime.Application.Interfaces;
using Planora.Realtime.Infrastructure.Grpc;
using Planora.Realtime.Infrastructure.Hubs;
using Planora.Realtime.Infrastructure.Services;

namespace Planora.UnitTests.Services.RealtimeApi.Infrastructure;

public sealed class RealtimePrivacyTests
{
    [Fact]
    [Trait("TestType", "Security")]
    public async Task BranchChanged_AfterRevocation_OnlyAddressesCurrentAudience()
    {
        var owner = Guid.NewGuid();
        var formerFriend = Guid.NewGuid();
        var task = Guid.NewGuid();
        var audience = new[] { owner, formerFriend };
        var authorizer = Authorizer(() => Access(audience));
        var proxy = new Mock<IClientProxy>();
        var clients = new Mock<IHubClients>();
        clients.Setup(x => x.Group(It.IsAny<string>())).Returns(proxy.Object);
        clients.Setup(x => x.Groups(It.IsAny<IReadOnlyList<string>>())).Returns(proxy.Object);
        var context = new Mock<IHubContext<NotificationHub>>();
        context.SetupGet(x => x.Clients).Returns(clients.Object);
        using var provider = new ServiceCollection().AddLogging()
            .AddSingleton(context.Object).AddSingleton<ITaskBranchAuthorizer>(authorizer)
            .BuildServiceProvider();
        var broadcaster = ActivatorUtilities.CreateInstance<RealtimeBroadcaster>(provider);

        await broadcaster.BranchChangedAsync(task, "comment.added", Guid.NewGuid(), owner);
        audience = [owner]; // current friendship/share revoked before the next event is delivered
        await broadcaster.BranchChangedAsync(task, "comment.added", Guid.NewGuid(), owner);

        clients.Verify(x => x.Group($"task:{task}"), Times.Never);
        clients.Verify(x => x.Groups(It.Is<IReadOnlyList<string>>(groups =>
            groups.SequenceEqual(new[] { $"task:{task}:user:{owner}" }))), Times.Once);
        clients.Verify(x => x.Groups(It.Is<IReadOnlyList<string>>(groups =>
            groups.Contains($"task:{task}:user:{formerFriend}"))), Times.Once);
        proxy.Verify(x => x.SendCoreAsync("BranchChanged", It.IsAny<object?[]>(), It.IsAny<CancellationToken>()), Times.Exactly(2));
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    [Trait("TestType", "Security")]
    public async Task Typing_AfterRevocation_EvictsCallerAndDoesNotSend(bool start)
    {
        var user = Guid.NewGuid();
        var task = Guid.NewGuid();
        var allowed = true;
        var authorizer = Authorizer(() => allowed ? Access([user]) : new CheckTaskCommentAccessResponse { Exists = true });
        var (hub, proxy, groups, _) = Hub(user, authorizer);
        await hub.JoinTask(task.ToString());
        allowed = false;

        if (start) await hub.StartTyping(task.ToString());
        else await hub.StopTyping(task.ToString());

        proxy.Verify(x => x.SendCoreAsync(It.IsAny<string>(), It.IsAny<object?[]>(), It.IsAny<CancellationToken>()), Times.Never);
        groups.Verify(x => x.RemoveFromGroupAsync("connection", $"task:{task}:user:{user}", It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    [Trait("TestType", "Security")]
    public async Task Typing_AfterTokenExpiration_AbortsAndDoesNotSend()
    {
        var user = Guid.NewGuid();
        var task = Guid.NewGuid();
        var (hub, proxy, _, caller) = Hub(user, Authorizer(() => Access([user])));
        await hub.JoinTask(task.ToString());
        caller.SetupGet(x => x.User).Returns(Principal(user, DateTimeOffset.UtcNow.AddMinutes(-1)));

        await hub.StartTyping(task.ToString());

        caller.Verify(x => x.Abort(), Times.Once);
        proxy.Verify(x => x.SendCoreAsync(It.IsAny<string>(), It.IsAny<object?[]>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    [Trait("TestType", "Resilience")]
    public async Task Typing_WhenTodoIsUnavailable_SuppressesWithoutEvictingAndResumes()
    {
        var user = Guid.NewGuid();
        var task = Guid.NewGuid();
        var available = true;
        var (hub, proxy, groups, _) = Hub(user, Authorizer(() => available
            ? Access([user]) : new RpcException(new Status(StatusCode.Unavailable, "unavailable"))));
        await hub.JoinTask(task.ToString());
        available = false;
        await hub.StartTyping(task.ToString());
        proxy.Verify(x => x.SendCoreAsync(It.IsAny<string>(), It.IsAny<object?[]>(), It.IsAny<CancellationToken>()), Times.Never);
        groups.Verify(x => x.RemoveFromGroupAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
        available = true;
        await hub.StartTyping(task.ToString());
        proxy.Verify(x => x.SendCoreAsync("UserTyping", It.IsAny<object?[]>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Theory]
    [InlineData("start")]
    [InlineData("stop")]
    [InlineData("leave")]
    [InlineData("disconnect")]
    [Trait("TestType", "Security")]
    public async Task Presence_OnlyAddressesCurrentRecipients(string operation)
    {
        var user = Guid.NewGuid();
        var formerFriend = Guid.NewGuid();
        var task = Guid.NewGuid();
        var audience = new[] { user, formerFriend };
        var (hub, proxy, _, _) = Hub(user, Authorizer(() => Access(audience)));
        await hub.JoinTask(task.ToString());
        audience = [user]; // the silent former member stays connected but is never addressed

        switch (operation)
        {
            case "start": await hub.StartTyping(task.ToString()); break;
            case "stop": await hub.StopTyping(task.ToString()); break;
            case "leave": await hub.LeaveTask(task.ToString()); break;
            case "disconnect": await hub.OnDisconnectedAsync(null); break;
        }

        var clients = Mock.Get(hub.Clients);
        clients.Verify(x => x.OthersInGroup(It.IsAny<string>()), Times.Never);
        clients.Verify(x => x.GroupExcept($"task:{task}:user:{formerFriend}", It.IsAny<IReadOnlyList<string>>()), Times.Never);
        clients.Verify(x => x.GroupExcept($"task:{task}:user:{user}",
            It.Is<IReadOnlyList<string>>(excluded => excluded.SequenceEqual(new[] { "connection" }))), Times.Once);
        proxy.Verify(x => x.SendCoreAsync(It.IsAny<string>(), It.IsAny<object?[]>(), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    [Trait("TestType", "Security")]
    public async Task Presence_AfterRevocation_DoesNotLeakFromLeaveOrDisconnect(bool disconnect)
    {
        var user = Guid.NewGuid();
        var task = Guid.NewGuid();
        var allowed = true;
        var (hub, proxy, _, _) = Hub(user, Authorizer(() => allowed
            ? Access([user]) : new CheckTaskCommentAccessResponse { Exists = true }));
        await hub.JoinTask(task.ToString());
        allowed = false;

        if (disconnect) await hub.OnDisconnectedAsync(null);
        else await hub.LeaveTask(task.ToString());

        proxy.Verify(x => x.SendCoreAsync(It.IsAny<string>(), It.IsAny<object?[]>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Theory]
    [InlineData("denied")]
    [InlineData("deleted")]
    [InlineData("unavailable")]
    [Trait("TestType", "Security")]
    public async Task BranchChanged_WithoutCurrentAuthority_DoesNotSend(string result)
    {
        var authorizer = Authorizer(() => result switch
        {
            "denied" => new CheckTaskCommentAccessResponse { Exists = true },
            "deleted" => new CheckTaskCommentAccessResponse(),
            _ => new RpcException(new Status(StatusCode.Unavailable, "unavailable")),
        });
        var context = new Mock<IHubContext<NotificationHub>>(MockBehavior.Strict);
        var broadcaster = new RealtimeBroadcaster(context.Object, Mock.Of<ILogger<RealtimeBroadcaster>>(), authorizer);

        await broadcaster.BranchChangedAsync(Guid.NewGuid(), "comment.added", Guid.NewGuid(), Guid.NewGuid());

        context.VerifyNoOtherCalls();
    }

    [Fact]
    [Trait("TestType", "Security")]
    public void HubEndpoint_ConfiguresAuthenticationExpirationClosure()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "Planora.sln")))
            directory = directory.Parent;
        Assert.NotNull(directory);
        var source = File.ReadAllText(Path.Combine(directory.FullName,
            "Services/RealtimeApi/Planora.Realtime.Api/Program.cs"));

        Assert.Matches(new Regex(@"MapHub<NotificationHub>\(""/hubs/notifications"",\s*options\s*=>\s*options\.CloseOnAuthenticationExpiration\s*=\s*true\)"), source);
    }

    private static (NotificationHub Hub, Mock<IClientProxy> Proxy, Mock<IGroupManager> Groups, Mock<HubCallerContext> Caller)
        Hub(Guid user, ITaskBranchAuthorizer authorizer)
    {
        var caller = new Mock<HubCallerContext>();
        caller.SetupGet(x => x.UserIdentifier).Returns(user.ToString());
        caller.SetupGet(x => x.ConnectionId).Returns("connection");
        caller.SetupGet(x => x.Items).Returns(new Dictionary<object, object?>());
        caller.SetupGet(x => x.User).Returns(Principal(user, DateTimeOffset.UtcNow.AddMinutes(10)));
        var proxy = new Mock<IClientProxy>();
        var clients = new Mock<IHubCallerClients>();
        clients.Setup(x => x.OthersInGroup(It.IsAny<string>())).Returns(proxy.Object);
        clients.Setup(x => x.GroupExcept(It.IsAny<string>(), It.IsAny<IReadOnlyList<string>>())).Returns(proxy.Object);
        var groups = new Mock<IGroupManager>();
        var hub = new NotificationHub(Mock.Of<ILogger<NotificationHub>>(), Mock.Of<IConnectionManager>(), authorizer,
            RealtimeSessionMonitorTests.CreateMonitor())
        {
            Context = caller.Object, Clients = clients.Object, Groups = groups.Object,
        };
        return (hub, proxy, groups, caller);
    }

    private static ClaimsPrincipal Principal(Guid user, DateTimeOffset expires) =>
        RealtimeSessionMonitorTests.Principal(user, DateTimeOffset.UtcNow.AddMinutes(-5), expires);

    private static CheckTaskCommentAccessResponse Access(IEnumerable<Guid> audience)
    {
        var response = new CheckTaskCommentAccessResponse { Exists = true, HasAccess = true };
        response.ParticipantIds.AddRange(audience.Select(id => id.ToString()));
        return response;
    }

    private static TaskBranchAuthorizer Authorizer(Func<object> response) =>
        new(new TodoService.TodoServiceClient(new UnaryInvoker(response)), Mock.Of<ILogger<TaskBranchAuthorizer>>());

    private sealed class UnaryInvoker(Func<object> response) : CallInvoker
    {
        public override AsyncUnaryCall<TResponse> AsyncUnaryCall<TRequest, TResponse>(Method<TRequest, TResponse> method,
            string? host, CallOptions options, TRequest request)
        {
            var result = response();
            var task = result is Exception exception ? Task.FromException<TResponse>(exception) : Task.FromResult((TResponse)result);
            return new AsyncUnaryCall<TResponse>(task, Task.FromResult(new Metadata()), () => Status.DefaultSuccess, () => new Metadata(), () => { });
        }
        public override TResponse BlockingUnaryCall<TRequest, TResponse>(Method<TRequest, TResponse> method, string? host, CallOptions options, TRequest request) => throw new NotSupportedException();
        public override AsyncClientStreamingCall<TRequest, TResponse> AsyncClientStreamingCall<TRequest, TResponse>(Method<TRequest, TResponse> method, string? host, CallOptions options) => throw new NotSupportedException();
        public override AsyncServerStreamingCall<TResponse> AsyncServerStreamingCall<TRequest, TResponse>(Method<TRequest, TResponse> method, string? host, CallOptions options, TRequest request) => throw new NotSupportedException();
        public override AsyncDuplexStreamingCall<TRequest, TResponse> AsyncDuplexStreamingCall<TRequest, TResponse>(Method<TRequest, TResponse> method, string? host, CallOptions options) => throw new NotSupportedException();
    }
}
