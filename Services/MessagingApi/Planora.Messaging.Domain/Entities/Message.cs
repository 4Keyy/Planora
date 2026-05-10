namespace Planora.Messaging.Domain.Entities
{
    public sealed class Message : BaseEntity, IAggregateRoot
    {
        public string Subject { get; private set; } = string.Empty;
        public string Body { get; private set; } = string.Empty;
        public Guid SenderId { get; private set; }
        public Guid RecipientId { get; private set; }
        public DateTime? ReadAt { get; private set; }
        public bool IsArchived { get; private set; }
        public string AttachmentUrls { get; private set; } = "[]"; // JSON array stored as string

        // Required for EF Core
        private Message() : base() { }

        public Message(string subject, string body, Guid senderId, Guid recipientId)
            : base()
        {
            if (string.IsNullOrWhiteSpace(subject))
                throw new ArgumentException("Subject cannot be empty", nameof(subject));
            if (string.IsNullOrWhiteSpace(body))
                throw new ArgumentException("Body cannot be empty", nameof(body));
            if (senderId == Guid.Empty)
                throw new ArgumentException("Sender ID cannot be empty", nameof(senderId));
            if (recipientId == Guid.Empty)
                throw new ArgumentException("Recipient ID cannot be empty", nameof(recipientId));
            if (senderId == recipientId)
                throw new InvalidOperationException("Cannot send message to self");

            Subject = subject;
            Body = body;
            SenderId = senderId;
            RecipientId = recipientId;
        }

        public void MarkAsRead()
        {
            if (ReadAt.HasValue)
                return;
            ReadAt = DateTime.UtcNow;
        }

        public void Archive()
        {
            IsArchived = true;
        }

        public void Unarchive()
        {
            IsArchived = false;
        }
    }
}
