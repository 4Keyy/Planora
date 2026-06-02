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
    }
}
