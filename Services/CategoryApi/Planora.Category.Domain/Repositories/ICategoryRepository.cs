namespace Planora.Category.Domain.Repositories
{
    public interface ICategoryRepository : IRepository<Entities.Category>
    {
        Task<IReadOnlyList<Entities.Category>> GetByUserIdAsync(Guid userId, CancellationToken cancellationToken = default);

        /// <summary>
        /// Soft-deletes every category owned by a user (used when that user's account is deleted) and
        /// returns how many were affected. Loads tracked so the xmin concurrency token is captured;
        /// changes are flushed by the caller's unit of work.
        /// </summary>
        Task<int> SoftDeleteByUserIdAsync(Guid userId, Guid deletedBy, CancellationToken cancellationToken = default);
        Task<IReadOnlyList<Entities.Category>> GetActiveByUserIdAsync(Guid userId, CancellationToken cancellationToken = default);
        Task<Entities.Category?> GetByIdAndUserIdAsync(Guid id, Guid userId, CancellationToken cancellationToken = default);
        Task<bool> ExistsByNameAndUserIdAsync(string name, Guid userId, CancellationToken cancellationToken = default);
    }
}
