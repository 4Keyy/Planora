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
            try
            {
                if (_options.UseLocalCache && _memoryCache.TryGetValue(key, out T? cachedValue))
                {
                    _logger.LogDebug("Cache hit (L1 Memory) for key: {Key}", key);
                    return cachedValue;
                }

                var cachedData = await _distributedCache.GetStringAsync(key, cancellationToken);
                if (string.IsNullOrEmpty(cachedData))
                {
                    _logger.LogDebug("Cache miss for key: {Key}", key);
                    return default;
                }

                var value = JsonSerializer.Deserialize<T>(cachedData);

                if (_options.UseLocalCache && value is not null)
                {
                    var memoryCacheOptions = new MemoryCacheEntryOptions
                    {
                        AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(5),
                        Size = 1
                    };
                    _memoryCache.Set(key, value, memoryCacheOptions);
                }

                _logger.LogDebug("Cache hit (L2 Redis) for key: {Key}", key);
                return value;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error getting cache for key: {Key}", key);
                return default;
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
                var serializedValue = JsonSerializer.Serialize(value);
                var expirationTime = expiration ?? _options.DefaultExpiration;

                var options = new DistributedCacheEntryOptions
                {
                    AbsoluteExpirationRelativeToNow = expirationTime
                };

                await _distributedCache.SetStringAsync(key, serializedValue, options, cancellationToken);

                if (_options.UseLocalCache)
                {
                    var memoryCacheOptions = new MemoryCacheEntryOptions
                    {
                        AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(5),
                        Size = 1
                    };
                    _memoryCache.Set(key, value, memoryCacheOptions);
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

            // L1 (in-process) cache cannot be enumerated; the only contract we can honour is
            // L2 (Redis) invalidation. Consumers must rely on the L1 absolute-expiration window
            // (currently 5 minutes) for the in-process layer.
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

                if (_options.UseLocalCache)
                {
                    // Best-effort: IMemoryCache does not expose its key set, so a pattern-wide
                    // L1 wipe is impossible. Document the contract: L1 entries naturally expire
                    // within 5 minutes; callers that need immediate L1 invalidation must call
                    // RemoveAsync with each concrete key.
                }

                _logger.LogInformation(
                    "Cache pattern-remove for {Pattern}: {Count} keys unlinked.",
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