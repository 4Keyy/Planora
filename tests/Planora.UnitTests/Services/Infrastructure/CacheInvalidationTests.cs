using Microsoft.Extensions.Caching.Distributed;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using Planora.BuildingBlocks.Infrastructure.Caching;

namespace Planora.UnitTests.Services.Infrastructure;

// The cache metrics suite listens to the process-wide counter and needs isolated measurements.
[CollectionDefinition(nameof(CacheInvalidationTests), DisableParallelization = true)]
public sealed class CacheInvalidationCollection
{
}

[Collection(nameof(CacheInvalidationTests))]
public sealed class CacheInvalidationTests
{
    private const string Key = "Todo:audit-invalidation";

    [Fact]
    public async Task RemoveAsync_EvictsLocalEntry_WhenDistributedRemoveFails()
    {
        var distributed = new Mock<IDistributedCache>();
        distributed.Setup(cache => cache.RemoveAsync(Key, It.IsAny<CancellationToken>()))
            .ThrowsAsync(new TimeoutException());
        using var memory = new MemoryCache(new MemoryCacheOptions());
        var service = CreateService(distributed.Object, memory);
        memory.Set(Key, "stale");

        await service.RemoveAsync(Key);

        Assert.False(memory.TryGetValue(Key, out _));
        Assert.Null(await service.GetAsync<string>(Key));
        distributed.Verify(cache => cache.GetAsync(Key, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task RemoveAsync_EvictsLocalEntry_AndPropagatesProviderCancellation()
    {
        using var cancellation = new CancellationTokenSource();
        var distributed = new Mock<IDistributedCache>();
        distributed.Setup(cache => cache.RemoveAsync(Key, cancellation.Token))
            .ThrowsAsync(new OperationCanceledException(cancellation.Token));
        using var memory = new MemoryCache(new MemoryCacheOptions());
        var service = CreateService(distributed.Object, memory);
        memory.Set(Key, "stale");

        var error = await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => service.RemoveAsync(Key, cancellation.Token));

        Assert.Equal(cancellation.Token, error.CancellationToken);
        Assert.False(memory.TryGetValue(Key, out _));
    }

    [Fact]
    public async Task GetAsync_PropagatesProviderCancellation()
    {
        using var cancellation = new CancellationTokenSource();
        var distributed = new Mock<IDistributedCache>();
        distributed.Setup(cache => cache.GetAsync(Key, cancellation.Token))
            .ThrowsAsync(new OperationCanceledException(cancellation.Token));
        using var memory = new MemoryCache(new MemoryCacheOptions());
        var service = CreateService(distributed.Object, memory);

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => service.GetAsync<string>(Key, cancellation.Token));
    }

    [Fact]
    public async Task SetAsync_PropagatesProviderCancellation()
    {
        using var cancellation = new CancellationTokenSource();
        var distributed = new Mock<IDistributedCache>();
        distributed.Setup(cache => cache.SetAsync(
                Key, It.IsAny<byte[]>(), It.IsAny<DistributedCacheEntryOptions>(), cancellation.Token))
            .ThrowsAsync(new OperationCanceledException(cancellation.Token));
        using var memory = new MemoryCache(new MemoryCacheOptions());
        var service = CreateService(distributed.Object, memory);

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => service.SetAsync(Key, "probe", cancellationToken: cancellation.Token));
        Assert.False(memory.TryGetValue(Key, out _));
    }

    [Fact]
    public async Task CancelledToken_IsObservedWithoutRedisAndOnLocalHit()
    {
        var distributed = new Mock<IDistributedCache>(MockBehavior.Strict);
        using var memory = new MemoryCache(new MemoryCacheOptions());
        var service = CreateService(distributed.Object, memory);
        memory.Set(Key, "warm");
        var cancelled = new CancellationToken(canceled: true);

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => service.GetAsync<string>(Key, cancelled));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => service.RemoveByPatternAsync("Todo:*", cancelled));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => service.RemoveAsync(Key, cancelled));
        Assert.False(memory.TryGetValue(Key, out _));
    }

    [Fact]
    public async Task Invalidator_DoesNotReportSuccess_WhenDistributedRemoveFails()
    {
        var distributed = new Mock<IDistributedCache>();
        distributed.Setup(cache => cache.RemoveAsync(Key, It.IsAny<CancellationToken>()))
            .ThrowsAsync(new TimeoutException());
        using var memory = new MemoryCache(new MemoryCacheOptions());
        var logger = new Mock<ILogger<CacheInvalidator>>();
        var invalidator = new CacheInvalidator(CreateService(distributed.Object, memory), logger.Object);

        await invalidator.InvalidateAsync(Key);

        Assert.DoesNotContain(logger.Invocations, invocation =>
            invocation.Method.Name == nameof(ILogger.Log) &&
            ((LogLevel)invocation.Arguments[0]!) == LogLevel.Information);
    }

    [Fact]
    public async Task RemoveAsync_EvictsOnlyTheCallingInstancesLocalEntry()
    {
        var distributed = new MemoryDistributedCache(Options.Create(new MemoryDistributedCacheOptions()));
        using var firstMemory = new MemoryCache(new MemoryCacheOptions());
        using var secondMemory = new MemoryCache(new MemoryCacheOptions());
        var first = CreateService(distributed, firstMemory);
        var second = CreateService(distributed, secondMemory);
        await first.SetAsync(Key, "before");
        Assert.Equal("before", await second.GetAsync<string>(Key));

        await first.RemoveAsync(Key);

        Assert.Null(await first.GetAsync<string>(Key));
        Assert.Equal("before", await second.GetAsync<string>(Key));
    }

    private static CacheService CreateService(IDistributedCache distributed, IMemoryCache memory) =>
        new(distributed, memory, Options.Create(new CacheOptions { UseLocalCache = true }),
            NullLogger<CacheService>.Instance);
}
