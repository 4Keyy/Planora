using Planora.Auth.Domain.Entities;

namespace Planora.Auth.Domain.Repositories
{
    public interface ILoginHistoryRepository : IRepository<LoginHistory>
    {
        Task<IReadOnlyList<LoginHistory>> GetByUserIdAsync(
            Guid userId,
            int count = 50,
            CancellationToken cancellationToken = default);

        Task<IReadOnlyList<LoginHistory>> GetRecentFailedAttemptsAsync(
            Guid userId,
            TimeSpan timeWindow,
            CancellationToken cancellationToken = default);

        Task DeleteOldHistoryAsync(DateTime olderThan, CancellationToken cancellationToken = default);
    }
}
