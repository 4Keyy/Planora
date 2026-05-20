using Planora.Auth.Domain.Entities;

namespace Planora.Auth.Domain.Repositories
{
    public interface IUserRecoveryCodeRepository : IRepository<UserRecoveryCode>
    {
        Task<IReadOnlyList<UserRecoveryCode>> GetUnusedByUserIdAsync(
            Guid userId,
            CancellationToken cancellationToken = default);

        Task DeleteAllForUserAsync(
            Guid userId,
            CancellationToken cancellationToken = default);
    }
}
