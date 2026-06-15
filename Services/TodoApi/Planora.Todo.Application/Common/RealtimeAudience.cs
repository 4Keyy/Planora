using Microsoft.Extensions.Logging;
using Planora.Todo.Application.Services;
using Planora.Todo.Domain.Entities;

namespace Planora.Todo.Application.Common
{
    /// <summary>
    /// Resolves who may currently see a task on their feed — the exact recipient set for the feed
    /// push of a <c>RealtimeSyncIntegrationEvent</c>. Centralizes the visibility rule so every task
    /// lifecycle handler computes the same audience: the owner always, the explicitly shared-with
    /// users, and — when the task is public — the owner's accepted friends. Resolving the audience
    /// here (where the visibility model and the friendship service live) keeps RealtimeApi free of
    /// any authorization logic; it only routes to the ids it is handed.
    ///
    /// <para>Friend resolution is <b>best-effort</b>: the live feed push is a non-critical UX
    /// enhancement, so a transient Auth-gRPC outage must never fail the underlying task mutation.
    /// If the friend list can't be fetched, the audience degrades to owner + shared-with (those
    /// users still sync), and the change is announced to friends on their next read. Cancellation
    /// still propagates — only the friendship service's own failures are swallowed.</para>
    /// </summary>
    internal static class RealtimeAudience
    {
        /// <summary>Resolves the feed audience from the task entity (requires SharedWith loaded).</summary>
        public static Task<IReadOnlyList<Guid>> ResolveAsync(
            TodoItem todo,
            IFriendshipService friendshipService,
            CancellationToken cancellationToken,
            ILogger? logger = null)
            => ResolveAsync(
                todo.UserId,
                todo.IsPublic,
                todo.SharedWith.Select(s => s.SharedWithUserId),
                friendshipService,
                cancellationToken,
                logger);

        /// <summary>Resolves the feed audience from primitive visibility inputs.</summary>
        public static async Task<IReadOnlyList<Guid>> ResolveAsync(
            Guid ownerId,
            bool isPublic,
            IEnumerable<Guid> sharedWithUserIds,
            IFriendshipService friendshipService,
            CancellationToken cancellationToken,
            ILogger? logger = null)
        {
            var audience = new HashSet<Guid> { ownerId };

            foreach (var sharedId in sharedWithUserIds)
                audience.Add(sharedId);

            if (isPublic)
            {
                foreach (var friendId in await SafeGetFriendIdsAsync(friendshipService, ownerId, cancellationToken, logger))
                    audience.Add(friendId);
            }

            audience.Remove(Guid.Empty);
            return audience.ToList();
        }

        /// <summary>
        /// Friend lookup that never throws (except on cancellation). A failure here only narrows the
        /// live-sync audience for one event — it must not bring down the task write that triggered it.
        /// </summary>
        public static async Task<IReadOnlyList<Guid>> SafeGetFriendIdsAsync(
            IFriendshipService friendshipService,
            Guid ownerId,
            CancellationToken cancellationToken,
            ILogger? logger = null)
        {
            try
            {
                return await friendshipService.GetFriendIdsAsync(ownerId, cancellationToken);
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception ex)
            {
                logger?.LogWarning(
                    ex,
                    "Live-sync feed audience could not include {OwnerId}'s friends (degraded to owner + shared-with)",
                    ownerId);
                return System.Array.Empty<Guid>();
            }
        }
    }
}
