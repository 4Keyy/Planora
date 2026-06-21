using System.Collections.Concurrent;
using Microsoft.Extensions.Primitives;

namespace Planora.BuildingBlocks.Infrastructure.Caching
{
    public sealed class CacheService : ICacheService
    {
        // Matches the StackExchangeRedisCache InstanceName set in
        // BuildingBlocks DependencyInjection. The provider prepends this prefix to every
        // key it writes, so SCAN must include it in the match pattern.
        private const string RedisInstanceName = "planora_";

        // Bound how many keys we delete per round-trip so a poisoned wildcard does not
        // produce a single 50 000-element DEL that blocks the Redis event loop.
        private const int UnlinkBatchSize = 500;

        // Defence against an unbounded callsite accidentally emitting per-id prefixes
        // and exploding the planora.cache.operations cardinality budget. Anything past
        // this length is collapsed to "_long_" so the metric stays useful.
        private const int MaxPrefixLength = 48;
        private const string PrefixFallback = "_other_";

        // Upper bound on how long an entry may live in the in-process L1 cache. The actual L1 TTL
        // is min(requested L2 TTL, this) so a short-lived L2 entry can never be served stale from L1
        // for longer than it was meant to live (previously L1 used a flat 5 min regardless of the
        // requested expiration).
        private static readonly TimeSpan L1MaxTtl = TimeSpan.FromMinutes(5);

        // One cancellation source per key prefix (entity name), wired as an expiration token onto
        // every L1 entry of that prefix. RemoveByPatternAsync cancels it to evict the whole prefix
        // from L1 in one shot — IMemoryCache cannot be enumerated, and over-eviction of L1 is safe
        // (it only causes a reload from L2, never a stale read).
        private readonly ConcurrentDictionary<string, CancellationTokenSource> _l1PrefixTokens = new();

        private readonly IDistributedCache _distributedCache;
        private readonly IMemoryCache _memoryCache;
        private readonly CacheOptions _options;
        private readonly StackExchange.Redis.IConnectionMultiplexer? _redis;
        private readonly ILogger<CacheService> _logger;

        public CacheService(
            IDistributedCache distributedCache,
            IMemoryCache memoryCache,
            IOptions<CacheOptions> options,
            ILogger<CacheService> logger,
            StackExchange.Redis.IConnectionMultiplexer? redis = null)
        {
            _distributedCache = distributedCache;
            _memoryCache = memoryCache;
            _options = options.Value;
            _redis = redis;
            _logger = logger;
        }

        public async Task<T?> GetAsync<T>(string key, CancellationToken cancellationToken = default)
        {
            var prefix = ExtractPrefix(key);
            try
            {
                if (_options.UseLocalCache && _memoryCache.TryGetValue(key, out T? cachedValue))
                {
                    _logger.LogDebug("Cache hit (L1 Memory) for key: {Key}", key);
                    RecordCacheOperation(prefix, "hit_l1");
                    return cachedValue;
                }

                var cachedData = await _distributedCache.GetStringAsync(key, cancellationToken);
                if (string.IsNullOrEmpty(cachedData))
                {
                    _logger.LogDebug("Cache miss for key: {Key}", key);
                    RecordCacheOperation(prefix, "miss");
                    return default;
                }

                var value = JsonSerializer.Deserialize<T>(cachedData);

                if (_options.UseLocalCache && value is not null)
                {
                    // Don't let L1 outlive the L2 entry: cap by the remaining L2 TTL when we can
                    // read it, otherwise by L1MaxTtl. BuildL1Options caps at L1MaxTtl regardless.
                    var remaining = await GetRemainingL2TtlAsync(key) ?? L1MaxTtl;
                    _memoryCache.Set(key, value, BuildL1Options(prefix, remaining));
                }

                _logger.LogDebug("Cache hit (L2 Redis) for key: {Key}", key);
                RecordCacheOperation(prefix, "hit_l2");
                return value;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error getting cache for key: {Key}", key);
                RecordCacheOperation(prefix, "error");
                return default;
            }
        }

        private static void RecordCacheOperation(string prefix, string outcome)
        {
            Planora.BuildingBlocks.Infrastructure.Observability.PlanoraMetrics.CacheOperations.Add(
                1,
                new System.Diagnostics.TagList { { "prefix", prefix }, { "outcome", outcome } });
        }

        // Extract a low-cardinality dimension from the cache key. CacheKeyBuilder produces
        // colon-delimited keys like "User:<guid>" or "Todo:list:userId:<guid>"; the first
        // segment is the entity name and is the single useful dimension to partition by.
        // Long or empty prefixes collapse to a fallback so the metric stays bounded even
        // if a future callsite forgets the convention.
        private static string ExtractPrefix(string key)
        {
            if (string.IsNullOrEmpty(key)) return PrefixFallback;
            var colon = key.IndexOf(':');
            var first = colon >= 0 ? key[..colon] : key;
            if (first.Length == 0 || first.Length > MaxPrefixLength) return PrefixFallback;
            return first;
        }

        // Build the L1 entry options: TTL capped at L1MaxTtl, plus a prefix-scoped expiration token
        // so RemoveByPatternAsync can evict the whole prefix from L1 at once.
        private MemoryCacheEntryOptions BuildL1Options(string prefix, TimeSpan requestedTtl)
        {
            var ttl = requestedTtl < L1MaxTtl ? requestedTtl : L1MaxTtl;
            if (ttl <= TimeSpan.Zero) ttl = L1MaxTtl;

            var options = new MemoryCacheEntryOptions
            {
                AbsoluteExpirationRelativeToNow = ttl,
                Size = 1
            };
            options.AddExpirationToken(new CancellationChangeToken(GetPrefixCts(prefix).Token));
            return options;
        }

        private CancellationTokenSource GetPrefixCts(string prefix) =>
            _l1PrefixTokens.GetOrAdd(prefix, _ => new CancellationTokenSource());

        // Remaining TTL of the L2 entry, used to bound the L1 copy so it cannot outlive L2.
        // Returns null when the raw multiplexer is unavailable or the key has no expiry.
        private async Task<TimeSpan?> GetRemainingL2TtlAsync(string key)
        {
            if (_redis is null) return null;
            try
            {
                return await _redis.GetDatabase().KeyTimeToLiveAsync(RedisInstanceName + key);
            }
            catch
            {
                return null;
            }
        }

        public async Task SetAsync<T>(
            string key,
            T value,
            TimeSpan? expiration = null,
            CancellationToken cancellationToken = default)
        {
            try
            {
                var prefix = ExtractPrefix(key);
                var serializedValue = JsonSerializer.Serialize(value);
                var expirationTime = expiration ?? _options.DefaultExpiration;

                var options = new DistributedCacheEntryOptions
                {
                    AbsoluteExpirationRelativeToNow = expirationTime
                };

                await _distributedCache.SetStringAsync(key, serializedValue, options, cancellationToken);

                if (_options.UseLocalCache)
                {
                    // L1 honours the requested TTL (capped at L1MaxTtl) instead of a flat 5 min,
                    // so a SetAsync(key, val, 30s) is never served from L1 for longer than 30s.
                    _memoryCache.Set(key, value, BuildL1Options(prefix, expirationTime));
                }

                _logger.LogDebug("Cache set for key: {Key}, Expiration: {Expiration}", key, expirationTime);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error setting cache for key: {Key}", key);
            }
        }

        public async Task RemoveAsync(string key, CancellationToken cancellationToken = default)
        {
            try
            {
                await _distributedCache.RemoveAsync(key, cancellationToken);

                if (_options.UseLocalCache)
                {
                    _memoryCache.Remove(key);
                }

                _logger.LogDebug("Cache removed for key: {Key}", key);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error removing cache for key: {Key}", key);
            }
        }

        public async Task RemoveByPatternAsync(string pattern, CancellationToken cancellationToken = default)
        {
            if (string.IsNullOrWhiteSpace(pattern))
            {
                return;
            }

            // L1: evict the entire first-segment prefix by cancelling its change token. IMemoryCache
            // cannot be enumerated, so we over-evict the prefix — safe, because L1 over-eviction only
            // forces a reload from L2 and never serves stale data. Done first so it happens even when
            // the raw multiplexer is unavailable (the Redis SCAN below is skipped in that case).
            if (_options.UseLocalCache)
            {
                var l1Prefix = ExtractPrefix(
                    pattern.StartsWith(RedisInstanceName, StringComparison.Ordinal)
                        ? pattern[RedisInstanceName.Length..]
                        : pattern);
                if (_l1PrefixTokens.TryRemove(l1Prefix, out var prefixCts))
                {
                    prefixCts.Cancel();
                    prefixCts.Dispose();
                }
            }

            if (_redis is null)
            {
                _logger.LogWarning(
                    "RemoveByPatternAsync called for pattern {Pattern} but no IConnectionMultiplexer is registered; skipping Redis SCAN.",
                    pattern);
                return;
            }

            var prefixed = pattern.StartsWith(RedisInstanceName, StringComparison.Ordinal)
                ? pattern
                : RedisInstanceName + pattern;

            try
            {
                var endpoints = _redis.GetEndPoints();
                var deleted = 0;

                foreach (var endpoint in endpoints)
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    var server = _redis.GetServer(endpoint);

                    // Only the primary handles writes; replicas refuse UNLINK. Skip non-primary
                    // endpoints to avoid noisy errors in clusters that expose both.
                    if (server.IsReplica)
                    {
                        continue;
                    }

                    var batch = new List<StackExchange.Redis.RedisKey>(UnlinkBatchSize);
                    var database = _redis.GetDatabase();

                    await foreach (var key in server.KeysAsync(pattern: prefixed, pageSize: UnlinkBatchSize).WithCancellation(cancellationToken))
                    {
                        batch.Add(key);
                        if (batch.Count >= UnlinkBatchSize)
                        {
                            deleted += (int)await database.KeyDeleteAsync([.. batch]);
                            batch.Clear();
                        }
                    }

                    if (batch.Count > 0)
                    {
                        deleted += (int)await database.KeyDeleteAsync([.. batch]);
                    }
                }

                _logger.LogInformation(
                    "Cache pattern-remove for {Pattern}: {Count} keys unlinked (L1 prefix evicted).",
                    pattern, deleted);
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error removing cache by pattern: {Pattern}", pattern);
            }
        }
    }
}