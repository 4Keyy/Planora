using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Planora.BuildingBlocks.Infrastructure.Retention;

namespace Planora.UnitTests.BuildingBlocks.Retention;

/// <summary>
/// Guard-logic coverage for <see cref="RetentionExecutor.RunAsync"/> — the four safety behaviours every
/// policy inherits — exercised with fake count/delete delegates and a fake lock, so no PostgreSQL is
/// needed. (The advisory lock and ExecuteDelete SQL themselves are Postgres-only and are validated on a
/// live dry-run during rollout.)
/// </summary>
public sealed class RetentionExecutorGuardTests
{
    private sealed class FakeLock : IRetentionLock
    {
        public bool Grant = true;
        public int Acquired;
        public int Released;

        public Task<bool> TryAcquireAsync(DbContext db, long key, CancellationToken ct)
        {
            if (Grant) Acquired++;
            return Task.FromResult(Grant);
        }

        public Task ReleaseAsync(DbContext db, long key)
        {
            Released++;
            return Task.CompletedTask;
        }
    }

    private static DbContext NewDbContext() =>
        new(new DbContextOptionsBuilder().UseInMemoryDatabase($"guard-{Guid.NewGuid():N}").Options);

    private static RetentionContext Ctx(RetentionOptions options) =>
        new(options, new DateTime(2026, 07, 07, 03, 00, 00, DateTimeKind.Utc));

    [Fact]
    [Trait("TestType", "Unit")]
    public async Task DryRun_CountsButNeverDeletes()
    {
        var options = new RetentionOptions { DryRun = true, MaxDeletionsPerRun = 100 };
        var fakeLock = new FakeLock();
        var deleteCalls = 0;

        var result = await RetentionExecutor.RunAsync(
            "p", NewDbContext(), fakeLock, Ctx(options),
            _ => Task.FromResult(5),
            (_, _) => { deleteCalls++; return Task.FromResult(0); },
            NullLogger.Instance, CancellationToken.None);

        Assert.True(result.DryRun);
        Assert.Equal(5, result.Scanned);
        Assert.Equal(0, result.Deleted);
        Assert.Equal(0, deleteCalls);
        Assert.Equal(1, fakeLock.Released); // lock always released after a successful acquire
    }

    [Fact]
    [Trait("TestType", "Unit")]
    public async Task Tripwire_AbortsWithoutDeleting_WhenEligibleExceedsCap()
    {
        var options = new RetentionOptions { DryRun = false, MaxDeletionsPerRun = 10 };
        var deleteCalls = 0;

        var result = await RetentionExecutor.RunAsync(
            "p", NewDbContext(), new FakeLock(), Ctx(options),
            _ => Task.FromResult(11),
            (_, _) => { deleteCalls++; return Task.FromResult(0); },
            NullLogger.Instance, CancellationToken.None);

        Assert.True(result.TrippedGuard);
        Assert.Equal(11, result.Scanned);
        Assert.Equal(0, result.Deleted);
        Assert.Equal(0, deleteCalls);
    }

    [Fact]
    [Trait("TestType", "Unit")]
    public async Task LockUnavailable_SkipsWithoutCountingOrDeleting()
    {
        var options = new RetentionOptions { DryRun = false, MaxDeletionsPerRun = 100 };
        var fakeLock = new FakeLock { Grant = false };
        var countCalls = 0;

        var result = await RetentionExecutor.RunAsync(
            "p", NewDbContext(), fakeLock, Ctx(options),
            _ => { countCalls++; return Task.FromResult(3); },
            (_, _) => Task.FromResult(0),
            NullLogger.Instance, CancellationToken.None);

        Assert.True(result.Skipped);
        Assert.Equal("lock_unavailable", result.SkipReason);
        Assert.Equal(0, countCalls);
        Assert.Equal(0, fakeLock.Released);
    }

    [Fact]
    [Trait("TestType", "Unit")]
    public async Task NormalRun_DeletesInBatchesUntilDrained()
    {
        var options = new RetentionOptions { DryRun = false, MaxDeletionsPerRun = 100, BatchSize = 2 };
        var batches = new Queue<int>(new[] { 2, 1, 0 }); // two full-ish batches then empty
        var fakeLock = new FakeLock();

        var result = await RetentionExecutor.RunAsync(
            "p", NewDbContext(), fakeLock, Ctx(options),
            _ => Task.FromResult(3),
            (_, _) => Task.FromResult(batches.Dequeue()),
            NullLogger.Instance, CancellationToken.None);

        Assert.False(result.DryRun);
        Assert.False(result.TrippedGuard);
        Assert.Equal(3, result.Scanned);
        Assert.Equal(3, result.Deleted);
        Assert.Equal(1, fakeLock.Released);
    }

    [Fact]
    [Trait("TestType", "Unit")]
    public async Task NothingEligible_ReturnsZeroWithoutDeleting()
    {
        var options = new RetentionOptions { DryRun = false, MaxDeletionsPerRun = 100 };
        var deleteCalls = 0;

        var result = await RetentionExecutor.RunAsync(
            "p", NewDbContext(), new FakeLock(), Ctx(options),
            _ => Task.FromResult(0),
            (_, _) => { deleteCalls++; return Task.FromResult(0); },
            NullLogger.Instance, CancellationToken.None);

        Assert.Equal(0, result.Scanned);
        Assert.Equal(0, result.Deleted);
        Assert.Equal(0, deleteCalls);
    }
}
