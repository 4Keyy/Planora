namespace Planora.Todo.Application.DTOs
{
    public sealed record TodoHiddenResponseDto
    {
        public required Guid Id { get; init; }
        public required bool Hidden { get; init; }
        public string? CategoryName { get; init; }
        public Guid? CategoryId { get; init; }
    }
}
