namespace Planora.Messaging.Application.DTOs
{
    public sealed record MessageDto
    {
        public required Guid Id { get; init; }
        public required string Subject { get; init; }
        public required string Body { get; init; }
        public required Guid SenderId { get; init; }
        public required Guid RecipientId { get; init; }
        public DateTime? ReadAt { get; init; }
        public required bool IsArchived { get; init; }
        public required DateTime CreatedAt { get; init; }
    }
}
