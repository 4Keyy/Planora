namespace Planora.Todo.Application.DTOs
{
    public sealed record ViewerPreferenceResponseDto
    {
        public required Guid TodoId { get; init; }
        public required bool HiddenByViewer { get; init; }
        public Guid? ViewerCategoryId { get; init; }
    }
}
