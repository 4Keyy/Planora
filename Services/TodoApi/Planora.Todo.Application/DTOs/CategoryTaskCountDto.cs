namespace Planora.Todo.Application.DTOs
{
    /// <summary>How many open top-level tasks the caller sees in one of their categories.</summary>
    public sealed record CategoryTaskCountDto
    {
        public required Guid CategoryId { get; init; }
        public required int OpenCount { get; init; }
    }
}
