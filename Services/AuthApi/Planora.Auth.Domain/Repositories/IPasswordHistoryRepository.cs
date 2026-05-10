using Planora.Auth.Domain.Entities;

namespace Planora.Auth.Domain.Repositories
{
    public interface IPasswordHistoryRepository : IRepository<PasswordHistory>
    {
        Task<IReadOnlyList<PasswordHistory>> GetByUserIdAsync(
            Guid userId,
            int count,
            CancellationToken cancellationToken = default);

        Task DeleteOldHistoryAsync(
            Guid userId,
            int keepCount,
            CancellationToken cancellationToken = default);
    }
}
