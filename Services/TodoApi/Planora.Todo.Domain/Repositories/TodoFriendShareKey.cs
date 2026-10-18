namespace Planora.Todo.Domain.Repositories;

/// <summary>A directed share and its task's last activity, without loading the aggregate.</summary>
public readonly record struct TodoFriendShareKey(
    Guid TodoId, Guid OwnerId, DateTime ActivityAt, Guid SharedWithUserId);
