using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;
using Planora.Todo.Application.Services;

namespace Planora.Todo.Infrastructure.Services
{
    /// <summary>
    /// In-memory cache in front of <see cref="FriendshipGrpcService"/> for the friend-id list only.
    ///
    /// <para>Legacy public tasks still resolve the realtime feed audience dynamically. A short TTL
    /// collapses repeated friend-id lookups within an editing session. Frozen All friends tasks use
    /// their materialized shares; <see cref="GetFriendshipsAsync"/> always bypasses this cache when
    /// choosing or backfilling a snapshot.</para>
    ///
    /// <para><b>Authorization stays fresh.</b> <see cref="AreFriendsAsync"/> — the call every access
    /// check flows through (GetTodoById, UpdateTodo, JoinTodo, DuplicateTodo) — is intentionally NOT
    /// cached. So even if a just-removed friend lingers in a cached id list for the TTL, the worst
    /// case is one content-free fan-out signal: their actual read is still denied by the live
    /// friendship check, and a created share row is inert behind that same check. No content leaks.</para>
    /// </summary>
    public sealed class CachingFriendshipService : IFriendshipService
    {
        private static readonly TimeSpan Ttl = TimeSpan.FromSeconds(30);
        private const string KeyPrefix = "todo:friend-ids:";

        private readonly IFriendshipService _inner;
        private readonly IMemoryCache _cache;
        private readonly ILogger<CachingFriendshipService> _logger;

        public CachingFriendshipService(
            IFriendshipService inner,
            IMemoryCache cache,
            ILogger<CachingFriendshipService> logger)
        {
            _inner = inner;
            _cache = cache;
            _logger = logger;
        }

        public async Task<IReadOnlyList<Guid>> GetFriendIdsAsync(
            Guid userId,
            CancellationToken cancellationToken = default)
        {
            if (_cache.TryGetValue(Key(userId), out IReadOnlyList<Guid>? cached) && cached is not null)
            {
                return cached;
            }

            var fresh = await _inner.GetFriendIdsAsync(userId, cancellationToken);

            _cache.Set(Key(userId), fresh, new MemoryCacheEntryOptions
            {
                AbsoluteExpirationRelativeToNow = Ttl,
                Size = 1,
            });

            _logger.LogDebug("Friend-id cache miss for {UserId}: {Count} fetched from Auth gRPC", userId, fresh.Count);
            return fresh;
        }

        /// <summary>Never cached — every authorization decision must see live friendship state.</summary>
        public Task<bool> AreFriendsAsync(Guid userId1, Guid userId2, CancellationToken cancellationToken = default)
            => _inner.AreFriendsAsync(userId1, userId2, cancellationToken);

        /// <summary>A materialized audience must use a fresh Auth snapshot, never the friend-id cache.</summary>
        public Task<IReadOnlyList<FriendshipInfo>> GetFriendshipsAsync(
            Guid userId, CancellationToken cancellationToken = default)
            => _inner.GetFriendshipsAsync(userId, cancellationToken);

        private static string Key(Guid id) => KeyPrefix + id.ToString("N");
    }
}
