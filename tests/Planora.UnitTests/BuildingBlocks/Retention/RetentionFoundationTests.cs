using Planora.BuildingBlocks.Infrastructure.Retention;

namespace Planora.UnitTests.BuildingBlocks.Retention;

/// <summary>
/// Unit coverage for the two subtle, DB-free correctness points of the retention harness: the daily
/// scheduling maths and the cross-process-stable advisory-lock key. The full <c>RetentionExecutor.RunAsync</c>
/// path (advisory lock + tripwire + batched ExecuteDelete) is Postgres-only and is exercised by the
/// per-policy integration tests.
/// </summary>
public sealed class RetentionFoundationTests
{
    // ── ComputeDelayToNextRun ─────────────────────────────────────────────────────────────────

    [Fact]
    [Trait("TestType", "Unit")]
    public void ComputeDelayToNextRun_BeforeHourToday_SchedulesForToday()
    {
        var now = new DateTime(2026, 07, 07, 01, 00, 00, DateTimeKind.Utc);

        var delay = RetentionBackgroundService.ComputeDelayToNextRun(now, runAtHourUtc: 3);

        Assert.Equal(TimeSpan.FromHours(2), delay);
    }

    [Fact]
    [Trait("TestType", "Unit")]
    public void ComputeDelayToNextRun_AfterHourToday_SchedulesForTomorrow()
    {
        var now = new DateTime(2026, 07, 07, 05, 00, 00, DateTimeKind.Utc);

        var delay = RetentionBackgroundService.ComputeDelayToNextRun(now, runAtHourUtc: 3);

        Assert.Equal(TimeSpan.FromHours(22), delay);
    }

    [Fact]
    [Trait("TestType", "Unit")]
    public void ComputeDelayToNextRun_ExactlyAtHour_SchedulesForNextDay()
    {
        var now = new DateTime(2026, 07, 07, 03, 00, 00, DateTimeKind.Utc);

        var delay = RetentionBackgroundService.ComputeDelayToNextRun(now, runAtHourUtc: 3);

        Assert.Equal(TimeSpan.FromHours(24), delay);
    }

    [Theory]
    [Trait("TestType", "Unit")]
    [InlineData(-5)]
    [InlineData(25)]
    [InlineData(99)]
    public void ComputeDelayToNextRun_ClampsHourAndStaysWithinADay(int hour)
    {
        var now = new DateTime(2026, 07, 07, 12, 34, 56, DateTimeKind.Utc);

        var delay = RetentionBackgroundService.ComputeDelayToNextRun(now, hour);

        Assert.True(delay > TimeSpan.Zero, "next run must always be in the future");
        Assert.True(delay <= TimeSpan.FromHours(24), "next run must be within one day");
    }

    // ── Advisory-lock key ─────────────────────────────────────────────────────────────────────

    [Fact]
    [Trait("TestType", "Unit")]
    public void KeyFor_IsDeterministic()
    {
        Assert.Equal(
            PostgresAdvisoryLock.KeyFor("soft-delete-purge"),
            PostgresAdvisoryLock.KeyFor("soft-delete-purge"));
    }

    [Fact]
    [Trait("TestType", "Unit")]
    public void KeyFor_DistinctNamesProduceDistinctKeys()
    {
        Assert.NotEqual(
            PostgresAdvisoryLock.KeyFor("outbox-inbox-purge"),
            PostgresAdvisoryLock.KeyFor("soft-delete-purge"));
    }

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Regression")]
    public void KeyFor_IsPinned_SoLockDoesNotSilentlyChangeAcrossReleases()
    {
        // Pinned FNV-1a(64) value. If this ever changes, running replicas would compute different keys
        // during a rolling deploy and briefly stop mutexing each other — hence the regression pin.
        Assert.Equal(5376894883882385383L, PostgresAdvisoryLock.KeyFor("outbox-inbox-purge"));
    }

    // ── IsEnabled contract sanity (RetentionResult helpers) ───────────────────────────────────

    [Fact]
    [Trait("TestType", "Unit")]
    public void SkippedResult_CarriesReason()
    {
        var result = RetentionResult.SkippedResult("some-policy", "lock_unavailable");

        Assert.True(result.Skipped);
        Assert.Equal("some-policy", result.PolicyName);
        Assert.Equal("lock_unavailable", result.SkipReason);
        Assert.Equal(0, result.Deleted);
    }
}
