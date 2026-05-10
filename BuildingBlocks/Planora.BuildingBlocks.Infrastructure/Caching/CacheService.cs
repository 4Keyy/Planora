namespace Planora.BuildingBlocks.Infrastructure.Caching
{
    public sealed class CacheService : ICacheService
    {
        private readonly IDistributedCache _distributedCache;
        private readonly IMemoryCache _memoryCache;
        private readonly CacheOptions _options;
        private readonly ILogger<CacheService> _logger;

        public CacheService(
            IDistributedCache distributedCache,
            IMemoryCache memoryCache,
            IOptions<CacheOptions> options,
            ILogger<CacheService> logger)
        {
            _distributedCache = distributedCache;
            _memoryCache = memoryCache;
            _options = options.Value;
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
            _logger.LogWarning("RemoveByPatternAsync not fully implemented - requires Redis SCAN");
            await Task.CompletedTask;
        }
    }
}