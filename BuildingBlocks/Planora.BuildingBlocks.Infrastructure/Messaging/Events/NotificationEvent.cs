namespace Planora.BuildingBlocks.Infrastructure.Messaging.Events
{
    public sealed class NotificationEvent : IntegrationEvent
    {
        public Guid UserId { get; set; }
        public string Title { get; set; } = string.Empty;
        public string Message { get; set; } = string.Empty;
        public string Type { get; set; } = string.Empty;

        public NotificationEvent()
        {
        }

        public NotificationEvent(Guid userId, string title, string message, string type)
            : base()
        {
            UserId = userId;
            Title = title;
            Message = message;
            Type = type;
        }
    }
}
