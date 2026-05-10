namespace Planora.BuildingBlocks.Infrastructure.Caching
{
    public sealed class CacheInvalidator : ICacheInvalidator
    {
        private readonly ICacheService _cacheService;
        private readonly ILogger<CacheInvalidator> _logger;

        public CacheInvalidator(
            ICacheService cacheService,
            ILogger<CacheInvalidator> logger)
        {
            _cacheService = cacheService;
            _logger = logger;
        }

        public async Task InvalidateAsync(string key, CancellationToken cancellationToken = default)
        {
            await _cacheService.RemoveAsync(key, cancellationToken);
            _logger.LogInformation("Cache invalidated for key: {Key}", key);
        }

        public async Task InvalidateByPatternAsync(string pattern, CancellationToken cancellationToken = default)
        {
            await _cacheService.RemoveByPatternAsync(pattern, cancellationToken);
            _logger.LogInformation("Cache invalidated for pattern: {Pattern}", pattern);
        }

        public async Task InvalidateEntityAsync<TEntity>(Guid id, CancellationToken cancellationToken = default)
        {
            var key = CacheKeyBuilder.ForEntity<TEntity>(id);
            await InvalidateAsync(key, cancellationToken);
        }

        public async Task InvalidateEntityListAsync<TEntity>(CancellationToken cancellationToken = default)
        {
            var pattern = CacheKeyBuilder.PatternForEntity<TEntity>();
            await InvalidateByPatternAsync(pattern, cancellationToken);
        }
    }
}
