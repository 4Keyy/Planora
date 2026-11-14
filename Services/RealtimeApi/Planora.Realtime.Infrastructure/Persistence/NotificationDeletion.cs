namespace Planora.Realtime.Infrastructure.Persistence;

// Values are persisted and also select the PostgreSQL advisory lock namespace.
internal enum NotificationDeletionScope
{
    Recipient = 1,
    Task = 2,
}

internal sealed class NotificationDeletion
{
    public NotificationDeletionScope Scope { get; init; }
    public Guid ScopeId { get; init; }
}
