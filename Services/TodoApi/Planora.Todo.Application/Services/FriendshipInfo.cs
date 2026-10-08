namespace Planora.Todo.Application.Services;

/// <summary>A live accepted friendship; null acceptance time denotes a legacy friendship.</summary>
public sealed record FriendshipInfo(Guid FriendId, DateTime? AcceptedAt);
