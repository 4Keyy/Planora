namespace Planora.BuildingBlocks.Application.Messaging.Events
{
    /// <summary>
    /// A per-user notification raised by a producer (TodoApi, CollaborationApi) through its
    /// transactional outbox and consumed by RealtimeApi, which persists it to the durable
    /// notification log and pushes it over SignalR (<c>ReceiveNotification</c>).
    ///
    /// <para>The actor who triggered the change is <b>always excluded</b> from the recipient set by
    /// the producer — you never get notified about your own action.</para>
    /// </summary>
    public sealed class NotificationEvent : IntegrationEvent
    {
        /// <summary>Recipient user (never the actor).</summary>
        public Guid UserId { get; set; }

        /// <summary>Short headline shown in the UI / OS notification title.</summary>
        public string Title { get; set; } = string.Empty;

        /// <summary>Body text.</summary>
        public string Message { get; set; } = string.Empty;

        /// <summary>
        /// Stable discriminator the frontend maps to an icon / tint / OS-notification policy
        /// (e.g. <c>comment.added</c>, <c>task.review</c>). See <see cref="NotificationType"/>.
        /// </summary>
        public string Type { get; set; } = string.Empty;

        /// <summary>
        /// The task (branch) this notification belongs to, so the client can route it to that task's
        /// card dot and branch unread badge. <see cref="System.Guid.Empty"/> means "not task-scoped".
        /// </summary>
        public Guid TaskId { get; set; }

        /// <summary>Who triggered the change — for display, and so a client can ignore its own echo.</summary>
        public Guid ActorId { get; set; }

        public NotificationEvent()
        {
        }

        public NotificationEvent(
            Guid userId,
            string title,
            string message,
            string type,
            Guid taskId = default,
            Guid actorId = default)
            : base()
        {
            UserId = userId;
            Title = title;
            Message = message;
            Type = type;
            TaskId = taskId;
            ActorId = actorId;
        }
    }
}
