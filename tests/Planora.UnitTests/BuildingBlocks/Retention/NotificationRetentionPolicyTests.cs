using System.Reflection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Planora.BuildingBlocks.Infrastructure.Retention;
using Planora.Realtime.Domain.Entities;
using Planora.Realtime.Infrastructure.Retention;

namespace Planora.UnitTests.BuildingBlocks.Retention;

/// <summary>
/// Eligibility coverage for the three RealtimeApi notification-retention policies (read 3d / unread 90d /
/// delivered 30d). Dry-run against EF InMemory asserts on the set each policy <em>would</em> delete.
/// </summary>
public sealed class NotificationRetentionPolicyTests
{
    private static readonly DateTime Now = new(2026, 07, 07, 03, 00, 00, DateTimeKind.Utc);

    private sealed class RealtimeRetentionTestDbContext : DbContext
    {
        public RealtimeRetentionTestDbContext(DbContextOptions options) : base(options) { }

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            modelBuilder.Entity<Notification>().Ignore("DomainEvents");
            modelBuilder.Entity<NotificationDelivery>().Ignore("DomainEvents");
        }
    }

    private sealed class AlwaysGrantLock : IRetentionLock
    {
        public Task<bool> TryAcquireAsync(DbContext db, long key, CancellationToken ct) => Task.FromResult(true);
        public Task ReleaseAsync(DbContext db, long key) => Task.CompletedTask;
    }

    private static void SetPrivate(object target, string property, object? value) =>
        target.GetType().GetProperty(property, BindingFlags.Public | BindingFlags.Instance)!
            .GetSetMethod(nonPublic: true)!.Invoke(target, new[] { value });

    private static Notification Read(DateTime readAt) =>
        Notify(occurredOn: Now, markReadAt: readAt);

    private static Notification Unread(DateTime occurredOn) =>
        Notify(occurredOn: occurredOn, markReadAt: null);

    private static Notification Notify(DateTime occurredOn, DateTime? markReadAt)
    {
        var n = new Notification(Guid.NewGuid(), "t", "m", "task.review", occurredOn, Guid.NewGuid());
        if (markReadAt is { } r)
        {
            n.MarkRead();
            SetPrivate(n, nameof(Notification.ReadAtUtc), r);
        }
        return n;
    }

    private static NotificationDelivery Delivered(DateTime? deliveredAt)
    {
        var d = new NotificationDelivery(Guid.NewGuid(), Guid.NewGuid());
        if (deliveredAt is { } at)
        {
            d.MarkDelivered();
            SetPrivate(d, nameof(NotificationDelivery.DeliveredAtUtc), at);
        }
        return d;
    }

    private static async Task<RetentionResult> RunAsync(IRetentionPolicy policy, RealtimeRetentionTestDbContext db, RetentionOptions options)
    {
        var services = new ServiceCollection();
        services.AddSingleton<DbContext>(db);
        await using var provider = services.BuildServiceProvider();
        return await policy.ExecuteAsync(provider, new RetentionContext(options, Now), CancellationToken.None);
    }

    private static RealtimeRetentionTestDbContext NewDb() =>
        new(new DbContextOptionsBuilder<RealtimeRetentionTestDbContext>()
            .UseInMemoryDatabase($"rt-{Guid.NewGuid():N}").Options);

    [Fact]
    [Trait("TestType", "Unit")]
    public async Task ReadPolicy_SelectsReadNotificationsPastReadWindow()
    {
        await using var db = NewDb();
        db.Add(Read(Now.AddDays(-5)));  // eligible
        db.Add(Read(Now.AddDays(-5)));  // eligible
        db.Add(Read(Now.AddDays(-1)));  // within window → kept
        db.Add(Unread(Now.AddDays(-5))); // not read → kept
        await db.SaveChangesAsync();

        var policy = new ReadNotificationPurgePolicy(new AlwaysGrantLock(), NullLogger<ReadNotificationPurgePolicy>.Instance);
        var result = await RunAsync(policy, db, new RetentionOptions { DryRun = true, ReadNotificationDays = 3, MaxDeletionsPerRun = 1000 });

        Assert.Equal(2, result.Scanned);
        Assert.Equal(0, result.Deleted);
    }

    [Fact]
    [Trait("TestType", "Unit")]
    public async Task UnreadPolicy_SelectsUnreadNotificationsPastAgeWindow()
    {
        await using var db = NewDb();
        db.Add(Unread(Now.AddDays(-100))); // eligible
        db.Add(Unread(Now.AddDays(-10)));  // within window → kept
        db.Add(Read(Now.AddDays(-100)));   // read → kept by this policy
        await db.SaveChangesAsync();

        var policy = new UnreadNotificationPurgePolicy(new AlwaysGrantLock(), NullLogger<UnreadNotificationPurgePolicy>.Instance);
        var result = await RunAsync(policy, db, new RetentionOptions { DryRun = true, UnreadNotificationDays = 90, MaxDeletionsPerRun = 1000 });

        Assert.Equal(1, result.Scanned);
    }

    [Fact]
    [Trait("TestType", "Unit")]
    public async Task DeliveryPolicy_SelectsDeliveredRowsPastWindow_KeepsPendingAndRecent()
    {
        await using var db = NewDb();
        db.Add(Delivered(Now.AddDays(-40))); // eligible
        db.Add(Delivered(Now.AddDays(-10))); // within window → kept
        db.Add(Delivered(null));             // pending (no DeliveredAtUtc) → kept
        await db.SaveChangesAsync();

        var policy = new NotificationDeliveryPurgePolicy(new AlwaysGrantLock(), NullLogger<NotificationDeliveryPurgePolicy>.Instance);
        var result = await RunAsync(policy, db, new RetentionOptions { DryRun = true, NotificationDeliveryDays = 30, MaxDeletionsPerRun = 1000 });

        Assert.Equal(1, result.Scanned);
    }
}
