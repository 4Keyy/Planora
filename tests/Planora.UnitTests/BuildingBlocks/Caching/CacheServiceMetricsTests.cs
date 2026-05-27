using System.Diagnostics.Metrics;
using Microsoft.Extensions.Caching.Distributed;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Planora.BuildingBlocks.Infrastructure.Caching;
using Planora.BuildingBlocks.Infrastructure.Observability;

namespace Planora.UnitTests.BuildingBlocks.Caching;

/// <summary>
/// Pins the cache-hit-ratio metric emission (T4.3). Records every counter
/// add via a MeterListener and asserts the right (prefix, outcome) pairs
/// fire for L1 hits, L2 hits, and misses. Hit-ratio dashboards in the
/// metrics back-end derive from these counts via rate() division.
/// </summary>
public sealed class CacheServiceMetricsTests
{
    [Fact]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Regression")]
    public async Task GetAsync_EmitsMissOutcome_WhenKeyAbsent()
    {
        var records = new List<(string Outcome, string Prefix)>();
        using var listener = SubscribeToCacheCounter(records);

        var service = CreateService(localCacheEnabled: false);

        var result = await service.GetAsync<string>("User:does-not-exist");

        Assert.Null(result);
        Assert.Single(records);
        Assert.Equal(("miss", "User"), records[0]);
    }

    [Fact]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Regression")]
    public async Task GetAsync_EmitsHitL1Outcome_AfterMemorySetSatisfiesNextRead()
    {
        var records = new List<(string Outcome, string Prefix)>();
        using var listener = SubscribeToCacheCounter(records);

        var service = CreateService(localCacheEnabled: true);

        await service.SetAsync("Todo:abc", "value", TimeSpan.FromMinutes(1));
        var result = await service.GetAsync<string>("Todo:abc");

        Assert.Equal("value", result);
        Assert.Single(records);
        Assert.Equal(("hit_l1", "Todo"), records[0]);
    }

    [Fact]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Regression")]
    public async Task GetAsync_EmitsHitL2Outcome_WhenLocalCacheDisabled()
    {
        var records = new List<(string Outcome, string Prefix)>();
        using var listener = SubscribeToCacheCounter(records);

        var service = CreateService(localCacheEnabled: false);

        await service.SetAsync("Category:xyz", "value", TimeSpan.FromMinutes(1));
        var result = await service.GetAsync<string>("Category:xyz");

        Assert.Equal("value", result);
        Assert.Single(records);
        Assert.Equal(("hit_l2", "Category"), records[0]);
    }

    [Fact]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Regression")]
    public async Task GetAsync_CollapsesUnboundedPrefixToFallback()
    {
        var records = new List<(string Outcome, string Prefix)>();
        using var listener = SubscribeToCacheCounter(records);

        var service = CreateService(localCacheEnabled: false);

        // A 100-char key with no colon — past the 48-char prefix cap, so the
        // metric must use the fallback dimension instead of leaking the full
        // string into the time-series database.
        var longKey = new string('x', 100);
        await service.GetAsync<string>(longKey);

        Assert.Single(records);
        Assert.Equal("_other_", records[0].Prefix);
        Assert.Equal("miss", records[0].Outcome);
    }

    private static CacheService CreateService(bool localCacheEnabled)
    {
        // In-memory IDistributedCache (Microsoft.Extensions.Caching.Memory.MemoryDistributedCache)
        // backs the L2 layer for these tests so the assertions don't require Redis.
        var distributedOptions = Options.Create(new MemoryDistributedCacheOptions());
        var distributedCache = new MemoryDistributedCache(distributedOptions);

        var memoryCacheOptions = Options.Create(new MemoryCacheOptions { SizeLimit = 1_000_000 });
        var memoryCache = new MemoryCache(memoryCacheOptions);

        var cacheOptions = Options.Create(new CacheOptions
        {
            UseLocalCache = localCacheEnabled,
            DefaultExpiration = TimeSpan.FromMinutes(5),
        });

        return new CacheService(
            distributedCache,
            memoryCache,
            cacheOptions,
            NullLogger<CacheService>.Instance,
            redis: null);
    }

    private static MeterListener SubscribeToCacheCounter(List<(string Outcome, string Prefix)> records)
    {
        var listener = new MeterListener();
        listener.InstrumentPublished = (instrument, l) =>
        {
            if (instrument.Meter.Name == PlanoraMetrics.MeterName
                && instrument.Name == "planora.cache.operations")
            {
                l.EnableMeasurementEvents(instrument);
            }
        };
        listener.SetMeasurementEventCallback<long>((instrument, measurement, tags, state) =>
        {
            string? outcome = null;
            string? prefix = null;
            foreach (var tag in tags)
            {
                if (tag.Key == "outcome") outcome = tag.Value?.ToString();
                else if (tag.Key == "prefix") prefix = tag.Value?.ToString();
            }
            if (outcome is not null && prefix is not null)
            {
                records.Add((outcome, prefix));
            }
        });
        listener.Start();
        return listener;
    }
}
