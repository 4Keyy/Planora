using Microsoft.EntityFrameworkCore;
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

public sealed class AllFriendsSnapshotBackfillPostgresTests
{
    private static readonly DateTime Created = new(2026, 1, 10, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void BatchCursor_TranslatesToPostgresUuidOrdering()
    {
        var options = new DbContextOptionsBuilder<TodoDbContext>()
            .UseNpgsql("Host=127.0.0.1;Database=planora_snapshot_sql;Username=fixture").Options;
        using var db = new TodoDbContext(options);
        var boundary = Guid.NewGuid();

        var sql = db.TodoItems.Where(todo => !todo.IsDeleted && todo.ParentTodoId == null &&
            todo.IsPublic && todo.AllFriendsSnapshotAt == null && todo.Id.CompareTo(boundary) > 0)
            .OrderBy(todo => todo.Id).Take(1).ToQueryString();

        Assert.Contains("ORDER BY", sql, StringComparison.OrdinalIgnoreCase);
        Assert.Contains(">", sql, StringComparison.Ordinal);
        Assert.Contains("IS NULL", sql, StringComparison.OrdinalIgnoreCase);
    }

    [PostgresFact]
    public async Task RealPostgres_FreezesTrackedExistingSharesAndCleansChildrenAtomically()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        var owner = Guid.NewGuid();
        var oldFriend = Guid.NewGuid();
        var explicitFriend = Guid.NewGuid();
        var lateFriend = Guid.NewGuid();
        var parent = Legacy(owner, "Historical parent", explicitFriend);
        parent.AddWorker(oldFriend);
        parent.AddWorker(lateFriend);
        var child = TodoItem.CreateSubtask(parent, owner, "Child", null);
        child.AddWorker(owner);
        child.AddWorker(lateFriend);
        var client = SnapshotClient(owner,
            [new(oldFriend, Created), new(explicitFriend, Created.AddDays(1)), new(lateFriend, Created.AddTicks(1))]);
        await using var host = await TestHost.CreateAsync(database, client.Object, parent, child);
        var childCreated = (await host.ReadAsync(child.Id)).CreatedAt;

        Assert.True(await host.Service.RunPassAsync());

        var saved = await host.ReadAsync(parent.Id);
        var savedChild = await host.ReadAsync(child.Id);
        Assert.Equal(Created, saved.CreatedAt);
        Assert.Equal(Created, saved.AllFriendsSnapshotAt);
        Assert.Equal(new[] { oldFriend, explicitFriend }.Order(), saved.SharedWith.Select(s => s.SharedWithUserId).Order());
        Assert.Equal(oldFriend, Assert.Single(saved.Workers).UserId);
        Assert.Equal(saved.SharedWith.Select(s => s.SharedWithUserId).Order(), savedChild.SharedWith.Select(s => s.SharedWithUserId).Order());
        Assert.Equal(Created, savedChild.AllFriendsSnapshotAt);
        Assert.Equal(childCreated, savedChild.CreatedAt);
        Assert.Equal(owner, Assert.Single(savedChild.Workers).UserId);
        Assert.True(await host.Service.RunPassAsync());
        client.Verify(x => x.GetFriendshipsAsync(owner, It.IsAny<CancellationToken>()), Times.Once);
    }

    [PostgresFact]
    public async Task RealPostgres_FailedFirstBatchDoesNotStarveLaterRowsAndRetriesWithFreshScopes()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        var failedOwner = Guid.NewGuid();
        var healthyOwner = Guid.NewGuid();
        var a = Legacy(failedOwner, "First");
        var b = Legacy(healthyOwner, "Second");
        var c = Legacy(healthyOwner, "Third");
        RetentionTestKit.Set(a, nameof(TodoItem.Id), new Guid("00000000-0000-0000-0000-000000000001"));
        RetentionTestKit.Set(b, nameof(TodoItem.Id), new Guid("00000000-0000-0000-0000-000000000002"));
        RetentionTestKit.Set(c, nameof(TodoItem.Id), new Guid("00000000-0000-0000-0000-000000000003"));
        var client = SnapshotClient(healthyOwner, Array.Empty<FriendshipInfo>());
        client.Setup(x => x.GetFriendshipsAsync(failedOwner, It.IsAny<CancellationToken>()))
            .ThrowsAsync(new ExternalServiceUnavailableException("AuthApi", "GetFriendships", new InvalidOperationException("Test Auth unavailable")));
        await using var host = await TestHost.CreateAsync(database, client.Object, [a, b, c], batchSize: 1);

        Assert.False(await host.Service.RunPassAsync());
        Assert.Null((await host.ReadAsync(a.Id)).AllFriendsSnapshotAt);
        Assert.Equal(Created, (await host.ReadAsync(b.Id)).AllFriendsSnapshotAt);
        Assert.Equal(Created, (await host.ReadAsync(c.Id)).AllFriendsSnapshotAt);
        client.Verify(x => x.GetFriendshipsAsync(healthyOwner, It.IsAny<CancellationToken>()), Times.Exactly(2));

        client.Setup(x => x.GetFriendshipsAsync(failedOwner, It.IsAny<CancellationToken>()))
            .ReturnsAsync(Array.Empty<FriendshipInfo>());
        Assert.True(await host.Service.RunPassAsync());
        Assert.Equal(Created, (await host.ReadAsync(a.Id)).AllFriendsSnapshotAt);
        client.Verify(x => x.GetFriendshipsAsync(healthyOwner, It.IsAny<CancellationToken>()), Times.Exactly(2));
    }

    [PostgresFact]
    public async Task RealPostgres_ConcurrentEditRollsBackSharesAndWorkersThenFreshRetryPreservesTheEdit()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        var owner = Guid.NewGuid();
        var oldFriend = Guid.NewGuid();
        var lateFriend = Guid.NewGuid();
        var parent = Legacy(owner, "Before concurrent edit");
        parent.AddWorker(lateFriend);
        var child = TodoItem.CreateSubtask(parent, owner, "Child", null);
        child.AddWorker(lateFriend);
        var calls = 0;
        var client = new Mock<IFriendshipService>();
        client.Setup(x => x.GetFriendshipsAsync(owner, It.IsAny<CancellationToken>()))
            .Returns(async (Guid _, CancellationToken ct) =>
            {
                if (Interlocked.Increment(ref calls) == 1)
                {
                    await using var writer = new TodoDbContext(database.Options<TodoDbContext>());
                    var current = await writer.TodoItems.SingleAsync(t => t.Id == parent.Id, ct);
                    current.UpdateTitle("Concurrent winner", owner);
                    await writer.SaveChangesAsync(ct);
                }
                return (IReadOnlyList<FriendshipInfo>)new[] { new FriendshipInfo(oldFriend, null) };
            });
        await using var host = await TestHost.CreateAsync(database, client.Object, parent, child);

        Assert.False(await host.Service.RunPassAsync());

        var unchangedParent = await host.ReadAsync(parent.Id);
        var unchangedChild = await host.ReadAsync(child.Id);
        Assert.Equal("Concurrent winner", unchangedParent.Title);
        Assert.Null(unchangedParent.AllFriendsSnapshotAt);
        Assert.Null(unchangedChild.AllFriendsSnapshotAt);
        Assert.Empty(unchangedParent.SharedWith);
        Assert.Empty(unchangedChild.SharedWith);
        Assert.Equal(lateFriend, Assert.Single(unchangedParent.Workers).UserId);
        Assert.Equal(lateFriend, Assert.Single(unchangedChild.Workers).UserId);

        Assert.True(await host.Service.RunPassAsync());
        var frozen = await host.ReadAsync(parent.Id);
        Assert.Equal("Concurrent winner", frozen.Title);
        Assert.Equal(Created, frozen.AllFriendsSnapshotAt);
        Assert.Equal(oldFriend, Assert.Single(frozen.SharedWith).SharedWithUserId);
        Assert.Empty(frozen.Workers);
        Assert.Empty((await host.ReadAsync(child.Id)).Workers);
        Assert.Equal(2, calls);
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

    private sealed class TestHost(ServiceProvider provider, int batchSize) : IAsyncDisposable
    {
        public AllFriendsSnapshotBackfillService Service { get; } =
            new(provider.GetRequiredService<IServiceScopeFactory>(), NullLogger<AllFriendsSnapshotBackfillService>.Instance, batchSize);

        public static Task<TestHost> CreateAsync(TemporaryDatabase database, IFriendshipService client, params TodoItem[] seed) =>
            CreateAsync(database, client, seed, batchSize: 64);

        public static async Task<TestHost> CreateAsync(TemporaryDatabase database, IFriendshipService client, TodoItem[] seed, int batchSize)
        {
            var services = new ServiceCollection();
            services.AddDbContext<TodoDbContext>(options => options.UseNpgsql(database.ConnectionString,
                npgsql => npgsql.EnableRetryOnFailure(3, TimeSpan.FromSeconds(1), null)));
            services.AddScoped<IFriendshipService>(_ => client);
            var host = new TestHost(services.BuildServiceProvider(), batchSize);
            await using var scope = host._provider.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<TodoDbContext>();
            await db.Database.EnsureCreatedAsync();
            db.TodoItems.AddRange(seed);
            await db.SaveChangesAsync();
            return host;
        }

        private readonly ServiceProvider _provider = provider;

        public async Task<TodoItem> ReadAsync(Guid id)
        {
            await using var scope = _provider.CreateAsyncScope();
            return await scope.ServiceProvider.GetRequiredService<TodoDbContext>().TodoItems.AsNoTracking()
                .Include(t => t.SharedWith).Include(t => t.Workers).SingleAsync(t => t.Id == id);
        }

        public async ValueTask DisposeAsync()
        {
            Service.Dispose();
            await _provider.DisposeAsync();
        }
    }
}
