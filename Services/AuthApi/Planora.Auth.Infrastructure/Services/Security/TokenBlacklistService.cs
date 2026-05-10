namespace Planora.Auth.Infrastructure.Services.Security
{
    public sealed class TokenBlacklistService : ITokenBlacklistService
    {
        private readonly IDistributedCache _cache;
        private readonly ILogger<TokenBlacklistService> _logger;
        private const string BlacklistPrefix = "token:blacklist:";

        public TokenBlacklistService(
            IDistributedCache cache,
            ILogger<TokenBlacklistService> logger)
        {
            _cache = cache;
            _logger = logger;
        }

        public async Task AddToBlacklistAsync(
            string token,
            DateTime expiresAt,
            CancellationToken cancellationToken = default)
        {
            try
            {
                var key = $"{BlacklistPrefix}{token}";
                var ttl = expiresAt - DateTime.UtcNow;

                if (ttl.TotalSeconds > 0)
                {
                    var options = new DistributedCacheEntryOptions
                    {
                        AbsoluteExpirationRelativeToNow = ttl
                    };

                    await _cache.SetStringAsync(key, "1", options, cancellationToken);

                    _logger.LogInformation(
                        "Token added to blacklist, expires in {Minutes} minutes",
                        ttl.TotalMinutes);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error adding token to blacklist");
                throw;
            }
        }

        // Adapter for application interface
        public async Task BlacklistTokenAsync(string token, TimeSpan expiration, CancellationToken cancellationToken = default)
        {
            var expiresAt = DateTime.UtcNow.Add(expiration);
            await AddToBlacklistAsync(token, expiresAt, cancellationToken);
        }

        public async Task<bool> IsTokenBlacklistedAsync(
            string token,
            CancellationToken cancellationToken = default)
        {
            try
            {
                var key = $"{BlacklistPrefix}{token}";
                var value = await _cache.GetStringAsync(key, cancellationToken);
                return !string.IsNullOrEmpty(value);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error checking token blacklist");
                return false;
            }
        }

        public async Task CleanupExpiredTokensAsync(CancellationToken cancellationToken = default)
        {
            await Task.CompletedTask;
            _logger.LogInformation("Token blacklist cleanup completed (handled by Redis TTL)");
        }

        // Adapter for application interface
        public async Task RemoveExpiredTokensAsync(CancellationToken cancellationToken = default)
        {
            await CleanupExpiredTokensAsync(cancellationToken);
        }
    }
}
