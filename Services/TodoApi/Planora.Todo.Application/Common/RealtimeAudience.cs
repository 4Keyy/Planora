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
    /// </summary>
    internal static class RealtimeAudience
    {
        /// <summary>Resolves the feed audience from the task entity (requires SharedWith loaded).</summary>
        public static Task<IReadOnlyList<Guid>> ResolveAsync(
            TodoItem todo,
            IFriendshipService friendshipService,
            CancellationToken cancellationToken)
            => ResolveAsync(
                todo.UserId,
                todo.IsPublic,
                todo.SharedWith.Select(s => s.SharedWithUserId),
                friendshipService,
                cancellationToken);

        /// <summary>Resolves the feed audience from primitive visibility inputs.</summary>
        public static async Task<IReadOnlyList<Guid>> ResolveAsync(
            Guid ownerId,
            bool isPublic,
            IEnumerable<Guid> sharedWithUserIds,
            IFriendshipService friendshipService,
            CancellationToken cancellationToken)
        {
            var audience = new HashSet<Guid> { ownerId };

            foreach (var sharedId in sharedWithUserIds)
                audience.Add(sharedId);

            if (isPublic)
            {
                var friends = await friendshipService.GetFriendIdsAsync(ownerId, cancellationToken);
                foreach (var friendId in friends)
                    audience.Add(friendId);
            }

            audience.Remove(Guid.Empty);
            return audience.ToList();
        }
    }
}
