using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Planora.Todo.Application.Exceptions;
using Planora.Todo.Application.Services;
using Planora.Todo.Domain.Entities;
using Planora.Todo.Infrastructure.Persistence;
using Planora.Todo.Infrastructure.Services;
using Planora.UnitTests.BuildingBlocks.Retention.Postgres;

namespace Planora.UnitTests.Services.TodoApi.Infrastructure;

public sealed class AllFriendsSnapshotBackfillTests
{
    private static readonly DateTime Created = new(2026, 1, 10, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public async Task Backfill_FreezesHistoricalAudiencePreservesExplicitSharesAndSyncsChildrenWorkers()
    {
        var owner = Guid.NewGuid();
        var oldFriend = Guid.NewGuid();
        var legacyFriend = Guid.NewGuid();
        var lateFriend = Guid.NewGuid();
        var explicitFriend = Guid.NewGuid();
        var parent = Legacy(owner, "Historical", explicitFriend);
        parent.AddWorker(oldFriend);
        parent.AddWorker(lateFriend);
        var child = TodoItem.CreateSubtask(parent, owner, "Child", null);
        child.AddWorker(owner);
        child.AddWorker(oldFriend);
        child.AddWorker(lateFriend);
        var childCreated = child.CreatedAt;
        var privateTodo = TodoItem.Create(owner, "Private");
        var friendships = new[]
        {
            new FriendshipInfo(oldFriend, Created),
            new FriendshipInfo(legacyFriend, null),
            new FriendshipInfo(lateFriend, Created.AddTicks(1)),
            new FriendshipInfo(explicitFriend, Created.AddDays(1)),
        };
        var client = SnapshotClient(owner, friendships);
        await using var host = await TestHost.CreateAsync(client.Object, parent, child, privateTodo);

        Assert.True(await host.Service.RunPassAsync());
        await using var scope = host.Provider.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<TodoDbContext>();
        var saved = await db.TodoItems.Include(t => t.SharedWith).Include(t => t.Workers).ToListAsync();
        var root = saved.Single(t => t.Id == parent.Id);
        var subtask = saved.Single(t => t.Id == child.Id);
        Assert.Equal(Created, root.CreatedAt);
        Assert.Equal(Created, root.AllFriendsSnapshotAt);
        Assert.True(root.IsPublic);
        Assert.Equal(new[] { oldFriend, legacyFriend, explicitFriend }.Order(), root.SharedWith.Select(s => s.SharedWithUserId).Order());
        Assert.Equal(new[] { oldFriend }, root.Workers.Select(w => w.UserId));
        Assert.Equal(Created, subtask.AllFriendsSnapshotAt);
        Assert.Equal(root.SharedWith.Select(s => s.SharedWithUserId).Order(), subtask.SharedWith.Select(s => s.SharedWithUserId).Order());
        Assert.Equal(new[] { oldFriend, owner }.Order(), subtask.Workers.Select(w => w.UserId).Order());
        Assert.Equal(childCreated, subtask.CreatedAt);
        Assert.Null(saved.Single(t => t.Id == privateTodo.Id).AllFriendsSnapshotAt);
    }

    [Fact]
    public async Task Backfill_IsIdempotentAndDoesNotRefreshAFrozenAudience()
    {
        var owner = Guid.NewGuid();
        var originalFriend = Guid.NewGuid();
        var laterFriend = Guid.NewGuid();
        var todo = Legacy(owner, "Already processed");
        var client = SnapshotClient(owner, [new(originalFriend, null)]);
        await using var host = await TestHost.CreateAsync(client.Object, todo);
        Assert.True(await host.Service.RunPassAsync());
        var first = await host.ReadAsync(todo.Id);
        var shareIds = first.SharedWith.Select(s => (s.TodoItemId, s.SharedWithUserId)).ToArray();
        client.Setup(x => x.GetFriendshipsAsync(owner, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { new FriendshipInfo(laterFriend, null) });

        Assert.True(await host.Service.RunPassAsync());

        var second = await host.ReadAsync(todo.Id);
        Assert.Equal(shareIds, second.SharedWith.Select(s => (s.TodoItemId, s.SharedWithUserId)));
        Assert.Equal(first.UpdatedAt, second.UpdatedAt);
        Assert.Equal(originalFriend, Assert.Single(second.SharedWith).SharedWithUserId);
        client.Verify(x => x.GetFriendshipsAsync(owner, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task Backfill_UnavailableOwnerDoesNotMutateAnyRowInItsBatchAndLaterPassRetries()
    {
        var availableOwner = Guid.NewGuid();
        var unavailableOwner = Guid.NewGuid();
        var friend = Guid.NewGuid();
        var a = Legacy(availableOwner, "One");
        var b = Legacy(unavailableOwner, "Two", friend);
        b.AddWorker(friend);
        var client = new Mock<IFriendshipService>();
        client.Setup(x => x.GetFriendshipsAsync(availableOwner, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { new FriendshipInfo(friend, null) });
        client.Setup(x => x.GetFriendshipsAsync(unavailableOwner, It.IsAny<CancellationToken>()))
            .ThrowsAsync(Unavailable());
        await using var host = await TestHost.CreateAsync(client.Object, a, b);

        Assert.False(await host.Service.RunPassAsync());
        Assert.Null((await host.ReadAsync(a.Id)).AllFriendsSnapshotAt);
        var unchanged = await host.ReadAsync(b.Id);
        Assert.Null(unchanged.AllFriendsSnapshotAt);
        Assert.Equal(b.CreatedAt, unchanged.CreatedAt);
        Assert.Equal(friend, Assert.Single(unchanged.SharedWith).SharedWithUserId);
        Assert.Equal(friend, Assert.Single(unchanged.Workers).UserId);

        client.Setup(x => x.GetFriendshipsAsync(unavailableOwner, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { new FriendshipInfo(friend, null) });
        Assert.True(await host.Service.RunPassAsync());
        Assert.Equal(Created, (await host.ReadAsync(a.Id)).AllFriendsSnapshotAt);
        Assert.Equal(Created, (await host.ReadAsync(b.Id)).AllFriendsSnapshotAt);
    }

    [Fact]
    public async Task Backfill_FailedFirstBatchCannotStarveOtherOwners()
    {
        var failedOwner = Guid.NewGuid();
        var healthyOwner = Guid.NewGuid();
        var a = Legacy(failedOwner, "Unavailable first");
        var b = Legacy(healthyOwner, "Healthy next");
        RetentionTestKit.Set(a, nameof(TodoItem.Id), new Guid("00000000-0000-0000-0000-000000000001"));
        RetentionTestKit.Set(b, nameof(TodoItem.Id), new Guid("00000000-0000-0000-0000-000000000002"));
        var client = new Mock<IFriendshipService>();
        client.Setup(x => x.GetFriendshipsAsync(failedOwner, It.IsAny<CancellationToken>()))
            .ThrowsAsync(Unavailable());
        client.Setup(x => x.GetFriendshipsAsync(healthyOwner, It.IsAny<CancellationToken>()))
            .ReturnsAsync(Array.Empty<FriendshipInfo>());
        await using var host = await TestHost.CreateAsync(client.Object, a, b);
        var batched = new AllFriendsSnapshotBackfillService(host.Provider.GetRequiredService<IServiceScopeFactory>(),
            NullLogger<AllFriendsSnapshotBackfillService>.Instance, batchSize: 1);

        Assert.False(await batched.RunPassAsync());
        Assert.Null((await host.ReadAsync(a.Id)).AllFriendsSnapshotAt);
        Assert.Equal(Created, (await host.ReadAsync(b.Id)).AllFriendsSnapshotAt);
        client.Verify(x => x.GetFriendshipsAsync(failedOwner, It.IsAny<CancellationToken>()), Times.Once);
        client.Verify(x => x.GetFriendshipsAsync(healthyOwner, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task HostedService_StartsBackfillAndRetriesAfterAuthRecovers()
    {
        var owner = Guid.NewGuid();
        var todo = Legacy(owner, "Startup retry");
        var calls = 0;
        var attempted = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var recovered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var client = new Mock<IFriendshipService>();
        client.Setup(x => x.GetFriendshipsAsync(owner, It.IsAny<CancellationToken>()))
            .Returns((Guid _, CancellationToken _) =>
            {
                if (Interlocked.Increment(ref calls) == 1)
                {
                    attempted.TrySetResult();
                    return Task.FromException<IReadOnlyList<FriendshipInfo>>(Unavailable());
                }
                recovered.TrySetResult();
                return Task.FromResult<IReadOnlyList<FriendshipInfo>>(Array.Empty<FriendshipInfo>());
            });
        await using var host = await TestHost.CreateAsync(client.Object, todo);

        await host.Service.StartAsync(CancellationToken.None);
        await attempted.Task.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Null((await host.ReadAsync(todo.Id)).AllFriendsSnapshotAt);
        await recovered.Task.WaitAsync(TimeSpan.FromSeconds(5));
        await host.Service.ExecuteTask!.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Equal(Created, (await host.ReadAsync(todo.Id)).AllFriendsSnapshotAt);
        await host.Service.StopAsync(CancellationToken.None);
        Assert.Equal(2, calls);
    }

    [Fact]
    public async Task Backfill_CancellationDoesNotFreezeTheRow()
    {
        var owner = Guid.NewGuid();
        var todo = Legacy(owner, "Cancelled");
        var client = new Mock<IFriendshipService>();
        client.Setup(x => x.GetFriendshipsAsync(owner, It.IsAny<CancellationToken>()))
            .ThrowsAsync(new OperationCanceledException());
        await using var host = await TestHost.CreateAsync(client.Object, todo);

        await Assert.ThrowsAsync<OperationCanceledException>(() => host.Service.RunPassAsync());
        Assert.Null((await host.ReadAsync(todo.Id)).AllFriendsSnapshotAt);
    }

    private static TodoItem Legacy(Guid owner, string title, params Guid[] shares)
    {
        var item = TodoItem.Create(owner, title, isPublic: true, sharedWithUserIds: shares);
        RetentionTestKit.Set(item, nameof(TodoItem.CreatedAt), Created);
        return item;
    }

    private static Mock<IFriendshipService> SnapshotClient(Guid owner, IReadOnlyList<FriendshipInfo> friends)
    {
        var client = new Mock<IFriendshipService>();
        client.Setup(x => x.GetFriendshipsAsync(owner, It.IsAny<CancellationToken>())).ReturnsAsync(friends);
        return client;
    }

    private static ExternalServiceUnavailableException Unavailable() =>
        new("AuthApi", "GetFriendships", new InvalidOperationException("Test Auth unavailable"));

    private sealed class TestHost(ServiceProvider provider) : IAsyncDisposable
    {
        public ServiceProvider Provider { get; } = provider;
        public AllFriendsSnapshotBackfillService Service { get; } =
            new(provider.GetRequiredService<IServiceScopeFactory>(), NullLogger<AllFriendsSnapshotBackfillService>.Instance);

        public static async Task<TestHost> CreateAsync(IFriendshipService client, params TodoItem[] seed)
        {
            var database = Guid.NewGuid().ToString();
            var root = new InMemoryDatabaseRoot();
            var services = new ServiceCollection();
            services.AddDbContext<TodoDbContext>(options => options.UseInMemoryDatabase(database, root));
            services.AddScoped<IFriendshipService>(_ => client);
            var host = new TestHost(services.BuildServiceProvider());
            await using var scope = host.Provider.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<TodoDbContext>();
            db.TodoItems.AddRange(seed);
            await db.SaveChangesAsync();
            return host;
        }

        public async Task<TodoItem> ReadAsync(Guid id)
        {
            await using var scope = Provider.CreateAsyncScope();
            return await scope.ServiceProvider.GetRequiredService<TodoDbContext>().TodoItems.AsNoTracking()
                .Include(t => t.SharedWith).Include(t => t.Workers).SingleAsync(t => t.Id == id);
        }

        public async ValueTask DisposeAsync()
        {
            Service.Dispose();
            await Provider.DisposeAsync();
        }
    }
}
