using Planora.BuildingBlocks.Infrastructure.Retention;

namespace Planora.UnitTests.BuildingBlocks.Retention;

/// <summary>
/// Unit coverage for the subtle, DB-free correctness points of the retention harness: the daily
/// scheduling maths, the cross-process-stable advisory-lock key and the defaults. The full
/// <c>RetentionExecutor.RunAsync</c> path (advisory lock + tripwire + batched ExecuteDelete) is
/// Postgres-only and is exercised live by the suites in <c>Postgres/</c> (set <c>PLANORA_TEST_POSTGRES</c>).
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

    [Theory]
    [Trait("TestType", "Unit")]
    [InlineData(10, 20, 40)]  // mid-morning → the top of the next hour
    [InlineData(1, 30, 30)]   // before the anchor hour → still the next whole hour, not the anchor
    [InlineData(23, 59, 1)]   // across midnight
    public void ComputeDelayToNextRun_Hourly_LandsOnTheNextWholeHour(int hour, int minute, int expectedMinutes)
    {
        // Hourly is the default: the archive says a task "deletes today", and a single 03:00 pass
        // let a task outlive that by up to a day.
        var now = new DateTime(2026, 10, 06, hour, minute, 00, DateTimeKind.Utc);

        var delay = RetentionBackgroundService.ComputeDelayToNextRun(now, runAtHourUtc: 3, everyHours: 1);

        Assert.Equal(TimeSpan.FromMinutes(expectedMinutes), delay);
    }

    [Theory]
    [Trait("TestType", "Unit")]
    [InlineData(10, 5)]  // grid 03 / 09 / 15 / 21 → 15:00
    [InlineData(22, 5)]  // → 03:00 tomorrow
    [InlineData(2, 1)]   // → 03:00 today
    [InlineData(9, 6)]   // exactly on a slot → the next one
    public void ComputeDelayToNextRun_EverySixHours_FollowsTheAnchorGrid(int hour, int expectedHours)
    {
        var now = new DateTime(2026, 10, 06, hour, 00, 00, DateTimeKind.Utc);

        var delay = RetentionBackgroundService.ComputeDelayToNextRun(now, runAtHourUtc: 3, everyHours: 6);

        Assert.Equal(TimeSpan.FromHours(expectedHours), delay);
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

    // ── Defaults ──────────────────────────────────────────────────────────────────────────────

    [Fact]
    [Trait("TestType", "Unit")]
    public void Defaults_RunLive_SoThePromisedDeletionsHappen()
    {
        // The archive promises "deletes in N days" and says "deletes today" on the last one. Shipped
        // disabled and in dry-run, the subsystem deleted nothing in any environment: completed tasks
        // and notifications stayed for months past every window.
        var options = new RetentionOptions();

        Assert.True(options.Enabled);
        Assert.False(options.DryRun);
        Assert.True(options.RunOnStartup);
        Assert.Equal(1, options.RunEveryHours);
        Assert.Equal(30, options.CompletedTaskDays);
        Assert.Equal(3, options.ReadNotificationDays);
        Assert.Equal(90, options.UnreadNotificationDays);
        Assert.Equal(7, options.SoftDeleteGraceDays);
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
