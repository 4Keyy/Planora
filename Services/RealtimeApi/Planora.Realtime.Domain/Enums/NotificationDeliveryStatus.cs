namespace Planora.Realtime.Domain.Enums;

/// <summary>
/// Lifecycle of a single SignalR delivery attempt for a persisted notification.
/// </summary>
public enum NotificationDeliveryStatus
{
    /// <summary>Persisted, not yet dispatched to SignalR.</summary>
    Pending = 0,

    /// <summary>SignalR send completed without throwing for at least one active connection.</summary>
    Delivered = 1,

    /// <summary>SignalR send attempted; no connections found for the target user.</summary>
    NotConnected = 2,

    /// <summary>SignalR send threw and exceeded retry budget.</summary>
    Failed = 3,
}
