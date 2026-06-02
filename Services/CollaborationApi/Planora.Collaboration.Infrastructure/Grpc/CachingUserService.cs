using Microsoft.Extensions.Caching.Memory;
using Planora.Collaboration.Application.Services;

namespace Planora.Collaboration.Infrastructure.Grpc
{
    /// <summary>
    /// In-memory cache wrapper around <see cref="IUserService"/>. Comment listings page through
    /// the same authors repeatedly; without caching each page hit Auth gRPC. A 60 s TTL bounds
    /// staleness when a user changes their name/avatar while keeping the cost of comment reads low.
    /// </summary>
    public sealed class CachingUserService : IUserService
    {
        private static readonly TimeSpan Ttl = TimeSpan.FromSeconds(60);
        private const string KeyPrefix = "collaboration:user-profile:";

        private readonly IUserService _inner;
        private readonly IMemoryCache _cache;
        private readonly ILogger<CachingUserService> _logger;

        public CachingUserService(
            IUserService inner,
            IMemoryCache cache,
            ILogger<CachingUserService> logger)
        {
            _inner = inner;
            _cache = cache;
            _logger = logger;
        }

        public async Task<IReadOnlyDictionary<Guid, UserProfile>> GetUserProfilesAsync(
            IEnumerable<Guid> userIds,
            CancellationToken cancellationToken = default)
        {
            var ids = userIds.Distinct().ToList();
            if (ids.Count == 0)
            {
                return new Dictionary<Guid, UserProfile>();
            }

            var result = new Dictionary<Guid, UserProfile>(ids.Count);
            var missing = new List<Guid>();

            foreach (var id in ids)
            {
                if (_cache.TryGetValue(Key(id), out CacheEntry? entry) && entry is not null)
                {
                    if (entry.Profile is not null)
                    {
                        result[id] = entry.Profile;
                    }
                }
                else
                {
                    missing.Add(id);
                }
            }

            if (missing.Count == 0)
            {
                return result;
            }

            var fresh = await _inner.GetUserProfilesAsync(missing, cancellationToken);

            foreach (var id in missing)
            {
                fresh.TryGetValue(id, out var profile);
                _cache.Set(Key(id), new CacheEntry(profile), new MemoryCacheEntryOptions
                {
                    AbsoluteExpirationRelativeToNow = Ttl,
                    Size = 1,
                });
                if (profile is not null)
                {
                    result[id] = profile;
                }
            }

            _logger.LogDebug(
                "Profile cache miss: {MissCount}/{TotalCount} fetched from Auth gRPC",
                missing.Count, ids.Count);

            return result;
        }

        private static string Key(Guid id) => KeyPrefix + id.ToString("N");

        private sealed record CacheEntry(UserProfile? Profile);
    }
}
