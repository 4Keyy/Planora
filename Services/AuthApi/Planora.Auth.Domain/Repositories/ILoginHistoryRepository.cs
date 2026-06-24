using Planora.Auth.Domain.Entities;

namespace Planora.Auth.Domain.Repositories
{
    public interface ILoginHistoryRepository : IRepository<LoginHistory>
    {
        Task<IReadOnlyList<LoginHistory>> GetByUserIdAsync(
            Guid userId,
            int count = 50,
            CancellationToken cancellationToken = default);

        /// <summary>
        /// Returns a single page of a user's login history (newest first) together with the true
        /// total row count, both computed in SQL. Unlike <see cref="GetByUserIdAsync"/> this does
        /// not cap the dataset, so the total is exact and large histories are not loaded into memory.
        /// </summary>
        Task<(IReadOnlyList<LoginHistory> Items, int TotalCount)> GetPagedByUserIdAsync(
            Guid userId,
            int pageNumber,
            int pageSize,
            CancellationToken cancellationToken = default);

        Task<IReadOnlyList<LoginHistory>> GetRecentFailedAttemptsAsync(
            Guid userId,
            TimeSpan timeWindow,
            CancellationToken cancellationToken = default);

        Task DeleteOldHistoryAsync(DateTime olderThan, CancellationToken cancellationToken = default);
    }
}
