using Planora.BuildingBlocks.Domain.Interfaces;
using Planora.Collaboration.Domain.Entities;

namespace Planora.Collaboration.Domain.Repositories
{
    public interface ICommentRepository : IRepository<Comment>
    {
        Task<(IReadOnlyList<Comment> Items, int TotalCount)> GetPagedByTaskIdAsync(
            Guid taskId, int pageNumber, int pageSize, CancellationToken ct = default);
        Task SoftDeleteByTaskIdAsync(Guid taskId, Guid deletedBy, CancellationToken ct = default);
    }
}
