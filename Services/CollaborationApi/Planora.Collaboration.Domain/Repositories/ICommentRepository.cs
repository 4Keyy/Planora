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
        /// Soft-deletes the subtask announcement system comments ("… added a subtask: {title}" /
        /// "… completed a subtask: {title}") within a parent task's branch, used when that subtask
        /// is deleted. Matches the deterministic sentence suffix produced by the activity consumer.
        /// </summary>
        Task SoftDeleteSubtaskActivityAsync(
            Guid parentTaskId, string subtaskTitle, Guid deletedBy, CancellationToken ct = default);
    }
}
