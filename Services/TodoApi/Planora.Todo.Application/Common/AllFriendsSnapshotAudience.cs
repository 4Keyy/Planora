using Planora.Todo.Application.Services;
using Planora.Todo.Domain.Entities;

namespace Planora.Todo.Application.Common;

/// <summary>Builds materialised All friends audiences from uncached, accepted friendship records.</summary>
public static class AllFriendsSnapshotAudience
{
    public static Guid[] Current(IReadOnlyList<FriendshipInfo> friendships, IEnumerable<Guid>? existingShares = null) =>
        friendships.Select(friend => friend.FriendId)
            .Concat(existingShares ?? Array.Empty<Guid>())
            .Where(id => id != Guid.Empty).Distinct().ToArray();

    public static Guid[] ForLegacy(TodoItem todo, IReadOnlyList<FriendshipInfo> friendships) =>
        Current(friendships.Where(friend => friend.AcceptedAt == null || friend.AcceptedAt <= todo.CreatedAt).ToArray(),
            todo.SharedWith.Select(share => share.SharedWithUserId));
}
