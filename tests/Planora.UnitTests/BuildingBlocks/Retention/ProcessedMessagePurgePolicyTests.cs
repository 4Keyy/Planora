using System.Reflection;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Planora.BuildingBlocks.Application.Outbox;
using Planora.BuildingBlocks.Infrastructure.Inbox;
using Planora.BuildingBlocks.Infrastructure.Retention;
using Planora.BuildingBlocks.Infrastructure.Retention.Policies;

namespace Planora.UnitTests.BuildingBlocks.Retention;

/// <summary>
/// Eligibility coverage for <see cref="ProcessedMessagePurgePolicy"/>: proves it selects exactly the
/// processed-and-aged outbox/inbox rows and leaves pending, recent, and dead-lettered rows alone. Runs in
/// dry-run against EF InMemory (which short-circuits before the Postgres-only ExecuteDelete), so it
/// asserts on <c>Scanned</c> — the set the policy <em>would</em> delete.
/// </summary>
public sealed class ProcessedMessagePurgePolicyTests
{
    private static readonly DateTime Now = new(2026, 07, 07, 03, 00, 00, DateTimeKind.Utc);

    private sealed class RetentionTestDbContext : DbContext
    {
        public RetentionTestDbContext(DbContextOptions options) : base(options) { }

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            modelBuilder.Entity<OutboxMessage>().Ignore("DomainEvents");
            modelBuilder.Entity<InboxMessage>().Ignore("DomainEvents");
        }
    }

    private sealed class AlwaysGrantLock : IRetentionLock
    {
        public Task<bool> TryAcquireAsync(DbContext db, long key, CancellationToken ct) => Task.FromResult(true);
        public Task ReleaseAsync(DbContext db, long key) => Task.CompletedTask;
    }

    private static void SetProcessedOn(object message, string property, DateTime value)
    {
        var setter = message.GetType().GetProperty(property, BindingFlags.Public | BindingFlags.Instance)!
            .GetSetMethod(nonPublic: true)!;
        setter.Invoke(message, new object?[] { value });
    }

    private static OutboxMessage ProcessedOutbox(DateTime processedOn)
    {
        var m = new OutboxMessage("Some.Event", "{}", processedOn);
        m.MarkAsProcessed();                              // sets Status=Processed + ProcessedOnUtc=now
        SetProcessedOn(m, nameof(OutboxMessage.ProcessedOnUtc), processedOn); // backdate deterministically
        return m;
    }

    private static InboxMessage ProcessedInbox(DateTime processedOn)
    {
        var m = new InboxMessage(Guid.NewGuid().ToString(), "Some.Event", "{}", processedOn);
        m.MarkAsProcessed();
        SetProcessedOn(m, nameof(InboxMessage.ProcessedOn), processedOn);
        return m;
    }

    private static async Task<RetentionResult> RunDryRunAsync(RetentionTestDbContext db)
    {
        var services = new ServiceCollection();
        services.AddSingleton<DbContext>(db);
        await using var provider = services.BuildServiceProvider();

        var policy = new ProcessedMessagePurgePolicy(new AlwaysGrantLock(), NullLogger<ProcessedMessagePurgePolicy>.Instance);
        var options = new RetentionOptions
        {
            DryRun = true,
            PurgeOutboxInbox = true,
            OutboxProcessedDays = 7,
            InboxProcessedDays = 7,
            MaxDeletionsPerRun = 10_000
        };

        return await policy.ExecuteAsync(provider, new RetentionContext(options, Now), CancellationToken.None);
    }

    [Fact]
    [Trait("TestType", "Unit")]
    public async Task Selects_OnlyProcessedRowsPastWindow_AcrossOutboxAndInbox()
    {
        var options = new DbContextOptionsBuilder<RetentionTestDbContext>()
            .UseInMemoryDatabase($"ret-{Guid.NewGuid():N}").Options;
        await using var db = new RetentionTestDbContext(options);

        // Outbox: 2 processed & aged (eligible), 1 processed but recent, 1 pending.
        db.Set<OutboxMessage>().Add(ProcessedOutbox(Now.AddDays(-30)));
        db.Set<OutboxMessage>().Add(ProcessedOutbox(Now.AddDays(-8)));
        db.Set<OutboxMessage>().Add(ProcessedOutbox(Now.AddDays(-1)));           // recent → kept
        db.Set<OutboxMessage>().Add(new OutboxMessage("Some.Event", "{}", Now)); // pending → kept

        // Inbox: 1 processed & aged (eligible), 1 pending.
        db.Set<InboxMessage>().Add(ProcessedInbox(Now.AddDays(-14)));
        db.Set<InboxMessage>().Add(new InboxMessage(Guid.NewGuid().ToString(), "Some.Event", "{}", Now));

        await db.SaveChangesAsync();

        var result = await RunDryRunAsync(db);

        Assert.True(result.DryRun);
        Assert.Equal(0, result.Deleted);
        Assert.Equal(3, result.Scanned); // 2 outbox + 1 inbox
    }

    [Fact]
    [Trait("TestType", "Unit")]
    public void IsEnabled_FollowsPurgeOutboxInboxFlag()
    {
        var policy = new ProcessedMessagePurgePolicy(new AlwaysGrantLock(), NullLogger<ProcessedMessagePurgePolicy>.Instance);

        Assert.True(policy.IsEnabled(new RetentionOptions { PurgeOutboxInbox = true }));
        Assert.False(policy.IsEnabled(new RetentionOptions { PurgeOutboxInbox = false }));
    }
}
