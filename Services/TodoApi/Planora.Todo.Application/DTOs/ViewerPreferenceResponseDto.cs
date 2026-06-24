namespace Planora.Todo.Application.DTOs
{
    public sealed record ViewerPreferenceResponseDto
    {
        public required Guid TodoId { get; init; }
        public required bool HiddenByViewer { get; init; }
        public Guid? ViewerCategoryId { get; init; }
        public bool? CompletedByViewer { get; init; }

        /// <summary>The author's real completion state (global <c>Status == Done</c>) at the time of
        /// this response. Lets the client decide whether a viewer reopen is even allowed before
        /// sending it (the server rejects it with <c>AUTHOR_ALREADY_COMPLETED</c> when true).</summary>
        public bool OwnerCompleted { get; init; }
    }
}
