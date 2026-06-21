using Planora.BuildingBlocks.Domain.Interfaces;
using Planora.Collaboration.Domain.Entities;

namespace Planora.Collaboration.Domain.Repositories
{
    public interface ICommentRepository : IRepository<Comment>
    {
        Task<(IReadOnlyList<Comment> Items, int TotalCount)> GetPagedByTaskIdAsync(
            Guid taskId, int pageNumber, int pageSize, CancellationToken ct = default);
        Task SoftDeleteByTaskIdAsync(Guid taskId, Guid deletedBy, CancellationToken ct = default);

        /// <summary>
        /// Soft-deletes every comment authored by a user (used when that user's account is deleted)
        /// and returns how many were affected. Loads tracked so the xmin concurrency token is
        /// captured; changes are flushed by the caller's unit of work.
        /// </summary>
        Task<int> SoftDeleteByAuthorAsync(Guid authorId, Guid deletedBy, CancellationToken ct = default);

        /// <summary>
        /// Soft-deletes the subtask announcement system comments ("… added a subtask: {title}" /
        /// "… completed a subtask: {title}") within a parent task's branch, used when that subtask
        /// is deleted. Matches the deterministic sentence suffix produced by the activity consumer.
        /// </summary>
        Task SoftDeleteSubtaskActivityAsync(
            Guid parentTaskId, string subtaskTitle, Guid deletedBy, CancellationToken ct = default);

        /// <summary>
        /// Batch-loads the live (non-deleted) comments with the given ids inside one task's
        /// branch. Used by the timeline read to refresh reply quotes from their live targets
        /// (live preview + deletion detection) in a single indexed query — never one query
        /// per reply.
        /// </summary>
        Task<IReadOnlyDictionary<Guid, Comment>> GetLiveByIdsAsync(
            Guid taskId, IReadOnlyCollection<Guid> commentIds, CancellationToken ct = default);

        /// <summary>
        /// Flags every reply in the parent branch that quotes the given subtask as
        /// "target deleted". The replies themselves survive with their snapshot preview.
        /// Naturally idempotent. Changes are flushed by the caller's unit of work.
        /// </summary>
        Task MarkSubtaskReplyTargetsDeletedAsync(
            Guid parentTaskId, Guid subtaskId, CancellationToken ct = default);
    }
}
