namespace Planora.Category.Application.DTOs
{
    public sealed record CategoryDto
    {
        public required Guid Id { get; init; }
        public required Guid UserId { get; init; }
        public required string Name { get; init; }
        public string? Description { get; init; }
        public required string Color { get; init; }
        public string? Icon { get; init; }
        public required int DisplayOrder { get; init; }
        public required DateTime CreatedAt { get; init; }
        public DateTime? UpdatedAt { get; init; }
    }
}