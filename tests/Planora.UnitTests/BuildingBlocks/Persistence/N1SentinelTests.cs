using Planora.BuildingBlocks.Infrastructure.Persistence;

namespace Planora.UnitTests.BuildingBlocks.Persistence;

/// <summary>
/// T4.1 — pins the N+1 sentinel interceptor accounting layer. The interceptor's
/// EF Core hook points (ReaderExecuting / NonQueryExecuting / ScalarExecuting
/// and their Async variants) all funnel into the public RecordCommand helper;
/// tests call RecordCommand directly to exercise the scope + threshold + whitelist
/// logic without standing up a real DbContext. Integration suites that need the
/// full EF interceptor wiring use AddInterceptors(new N1SentinelInterceptor()).
/// </summary>
public sealed class N1SentinelTests
{
    [Fact]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Regression")]
    public void RepeatedQueryShape_BeyondThreshold_RaisesViolation()
    {
        var ex = Assert.Throws<N1SentinelException>(() =>
        {
            using (N1SentinelInterceptor.BeginScope(threshold: 4))
            {
                // 6 identically-shaped reads (different parameter values, same fingerprint)
                // → 6 repeats vs threshold 4 → violation on dispose.
                for (int i = 1; i <= 6; i++)
                {
                    N1SentinelInterceptor.RecordCommand($"SELECT * FROM Users WHERE Id = ${i}");
                }
            }
        });

        Assert.Contains("N+1", ex.Message);
        Assert.Contains("SELECT * FROM Users WHERE Id = ?", ex.Message);
    }

    [Fact]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Regression")]
    public void RepeatedQueryShape_AtOrBelowThreshold_DoesNotRaise()
    {
        // Threshold = 5 means "5 is fine, 6 is the start of an N+1". Run exactly 5;
        // expect no exception on dispose.
        using (N1SentinelInterceptor.BeginScope(threshold: 5))
        {
            for (int i = 1; i <= 5; i++)
            {
                N1SentinelInterceptor.RecordCommand($"SELECT * FROM Users WHERE Id = ${i}");
            }
        }
    }

    [Fact]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Regression")]
    public void DistinctFingerprints_DoNotCombineForThreshold()
    {
        using (N1SentinelInterceptor.BeginScope(threshold: 3))
        {
            // Three different SELECT shapes, two repeats each — no fingerprint
            // crosses the threshold individually, so no violation even though
            // total reads (6) exceed the threshold (3).
            N1SentinelInterceptor.RecordCommand("SELECT * FROM Users WHERE Id = $1");
            N1SentinelInterceptor.RecordCommand("SELECT * FROM Users WHERE Id = $2");
            N1SentinelInterceptor.RecordCommand("SELECT * FROM Todos WHERE UserId = $1");
            N1SentinelInterceptor.RecordCommand("SELECT * FROM Todos WHERE UserId = $2");
            N1SentinelInterceptor.RecordCommand("SELECT * FROM Categories WHERE Id = $1");
            N1SentinelInterceptor.RecordCommand("SELECT * FROM Categories WHERE Id = $2");
        }
    }

    [Fact]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Regression")]
    public void WhitelistedFingerprint_DoesNotCountTowardThreshold()
    {
        // Caller declares the foreach over Users is intentional → whitelist exempts
        // the SELECT shape from the count even though it would otherwise trigger.
        using (N1SentinelInterceptor.BeginScope(threshold: 3, whitelist: new[] { "FROM Users" }))
        {
            for (int i = 1; i <= 8; i++)
            {
                N1SentinelInterceptor.RecordCommand($"SELECT * FROM Users WHERE Id = ${i}");
            }
        }
    }

    [Fact]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Regression")]
    public void OutsideAnyScope_RecordIsNoop()
    {
        // No BeginScope wrapper. RecordCommand must be a complete no-op so the
        // interceptor stays zero-cost in production.
        for (int i = 1; i <= 1000; i++)
        {
            N1SentinelInterceptor.RecordCommand($"SELECT * FROM Users WHERE Id = ${i}");
        }
        // No exception, no allocation visible to caller — pass by absence of failure.
    }

    [Fact]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Regression")]
    public void OnViolationCallback_OverridesDefaultThrow()
    {
        IReadOnlyList<N1Violation>? captured = null;

        // Custom callback collects violations without throwing — useful in CI
        // shadow mode where a failure should report rather than crash the test.
        using (N1SentinelInterceptor.BeginScope(threshold: 2, onViolation: v => captured = v))
        {
            for (int i = 1; i <= 5; i++)
            {
                N1SentinelInterceptor.RecordCommand($"SELECT * FROM Todos WHERE Id = ${i}");
            }
        }

        Assert.NotNull(captured);
        var single = Assert.Single(captured!);
        Assert.Equal(5, single.RepeatCount);
        Assert.Equal("SELECT * FROM Todos WHERE Id = ?", single.Fingerprint);
    }

    [Fact]
    [Trait("TestType", "Module")]
    public void Fingerprint_StripsParameterPlaceholdersAndCollapsesWhitespace()
    {
        var a = N1SentinelInterceptor.Fingerprint("SELECT * FROM Users WHERE Id = $1");
        var b = N1SentinelInterceptor.Fingerprint("SELECT  *   FROM  Users  WHERE  Id = $2");
        var c = N1SentinelInterceptor.Fingerprint("SELECT * FROM Users WHERE Id = @p__id");

        Assert.Equal(a, b);
        Assert.Equal(a, c);
        Assert.Equal("SELECT * FROM Users WHERE Id = ?", a);
    }

    [Fact]
    [Trait("TestType", "Module")]
    public void Fingerprint_HandlesEmptyAndWhitespaceCommands()
    {
        Assert.Equal(string.Empty, N1SentinelInterceptor.Fingerprint(""));
        Assert.Equal(string.Empty, N1SentinelInterceptor.Fingerprint("   "));
    }

    [Fact]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Regression")]
    public void NestedScopes_RestorePreviousScopeOnDispose()
    {
        // Outer scope has threshold=3. Inner scope (threshold=2) runs its own
        // accounting independently; on dispose the outer scope continues.
        using (N1SentinelInterceptor.BeginScope(threshold: 3))
        {
            N1SentinelInterceptor.RecordCommand("SELECT 1");
            N1SentinelInterceptor.RecordCommand("SELECT 1");

            var innerThrew = false;
            try
            {
                using (N1SentinelInterceptor.BeginScope(threshold: 2))
                {
                    for (int i = 0; i < 5; i++) N1SentinelInterceptor.RecordCommand("SELECT 2");
                }
            }
            catch (N1SentinelException)
            {
                innerThrew = true;
            }

            Assert.True(innerThrew);
            // Outer scope still active and has the two earlier records; under its
            // threshold of 3, so disposing it must not throw.
        }
    }
}
