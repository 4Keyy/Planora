using Planora.Collaboration.Domain.Entities;

namespace Planora.Collaboration.Application.Services;

public enum TimelineAppendResult
{
    Added,
    TaskDeleted,
    SubtaskDeleted
}

public interface IBranchTimeline
{
    /// <summary>Appends an entry and optionally stages its outbox events in the same transaction.</summary>
    Task<TimelineAppendResult> AppendAsync(Comment comment, CancellationToken cancellationToken,
        Func<CancellationToken, Task>? stageOutbox = null);

    Task DeleteTaskAsync(Guid taskId, Guid actorId, CancellationToken cancellationToken);
    Task DeleteSubtaskAsync(Guid taskId, Guid subtaskId, Guid actorId, CancellationToken cancellationToken);
}
