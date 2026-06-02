using Planora.Realtime.Domain.Enums;

namespace Planora.Realtime.Domain.Entities;

/// <summary>
/// One row per SignalR delivery attempt for a <see cref="Notification"/>. Decoupled
/// from <see cref="Notification"/> so an offline client coming back online can be
/// served a "you missed N notifications" replay without rewriting the original record.
/// </summary>
public sealed class NotificationDelivery : BaseEntity
{
    public Guid NotificationId { get; private set; }

    /// <summary>Recipient user — denormalised from the parent for cheap per-user querying.</summary>
    public Guid UserId { get; private set; }

    public NotificationDeliveryStatus Status { get; private set; }

    /// <summary>UTC timestamp the SignalR send completed (only set when <see cref="Status"/> is Delivered).</summary>
    public DateTime? DeliveredAtUtc { get; private set; }

    /// <summary>Number of dispatch attempts (re-deliveries on client reconnect are not counted).</summary>
    public int AttemptCount { get; private set; }

    /// <summary>Trimmed exception or error description for the last failed attempt.</summary>
    public string? LastError { get; private set; }

    private NotificationDelivery() { }

    public NotificationDelivery(Guid notificationId, Guid userId)
    {
        if (notificationId == Guid.Empty) throw new ArgumentException("NotificationId cannot be empty", nameof(notificationId));
        if (userId == Guid.Empty) throw new ArgumentException("UserId cannot be empty", nameof(userId));

        NotificationId = notificationId;
        UserId = userId;
        Status = NotificationDeliveryStatus.Pending;
        AttemptCount = 0;
    }

    public void MarkDelivered()
    {
        Status = NotificationDeliveryStatus.Delivered;
        DeliveredAtUtc = DateTime.UtcNow;
        AttemptCount++;
        LastError = null;
    }

    public void MarkNotConnected()
    {
        Status = NotificationDeliveryStatus.NotConnected;
        AttemptCount++;
    }

    public void MarkFailed(string error)
    {
        Status = NotificationDeliveryStatus.Failed;
        AttemptCount++;
        // Cap the error blob so a stack trace cannot blow the column width.
        LastError = string.IsNullOrEmpty(error) || error.Length <= 2000 ? error : error[..2000];
    }
}
