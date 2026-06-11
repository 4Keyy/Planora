namespace Planora.Collaboration.Application.Services
{
    /// <summary>
    /// Result of authorising a comment operation against a task owned by TodoApi.
    /// </summary>
    public sealed record TaskAccessResult(
        bool Exists,
        bool HasAccess,
        Guid OwnerId,
        IReadOnlyList<Guid> ParticipantIds,
        // Single source of truth for the task description (owned by Todo). The pinned
        // "Author's Note" is synthesised from this live value — Collaboration stores no
        // genesis comment copy. Empty when the task has no description.
        string Description,
        DateTime? TaskCreatedAt);

    /// <summary>
    /// Snapshot data for a subtask validated as a reply target: whether it is a live child of
    /// the branch's task, plus the quote material (title + author) captured on the reply.
    /// </summary>
    public sealed record SubtaskBrief(bool Exists, string Title, Guid AuthorId);

    /// <summary>
    /// Delegates task-comment authorisation to TodoApi (which owns the task aggregate and the
    /// ownership / sharing / public + friendship rules) over gRPC. The Collaboration service
    /// never reads Todo's database (INV-OWN-1) and never needs to know the sharing model.
    /// </summary>
    public interface ITaskAccessService
    {
        Task<TaskAccessResult> CheckCommentAccessAsync(
            Guid taskId,
            Guid requesterId,
            CancellationToken cancellationToken = default);

        /// <summary>
        /// Validates a subtask as a reply target within the given task's branch and returns
        /// the snapshot data the reply stores. <c>Exists == false</c> when the subtask is
        /// missing, deleted, or belongs to a different parent task.
        /// </summary>
        Task<SubtaskBrief> GetSubtaskBriefAsync(
            Guid taskId,
            Guid subtaskId,
            CancellationToken cancellationToken = default);
    }
}
