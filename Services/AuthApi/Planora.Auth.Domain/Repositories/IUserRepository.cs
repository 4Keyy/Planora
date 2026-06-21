using Planora.Auth.Domain.Entities;
using Planora.Auth.Domain.ValueObjects;

namespace Planora.Auth.Domain.Repositories
{
    public interface IUserRepository : IRepository<User>
    {
        Task<User?> GetByEmailAsync(Email email, CancellationToken cancellationToken = default);

        Task<bool> ExistsByEmailAsync(Email email, CancellationToken cancellationToken = default);

        Task<User?> GetWithRefreshTokensAsync(Guid userId, CancellationToken cancellationToken = default);
        
        Task<User?> GetByRefreshTokenAsync(string refreshToken, CancellationToken cancellationToken = default);

        Task<User?> GetByPasswordResetTokenAsync(string tokenHash, CancellationToken cancellationToken = default);

        Task<User?> GetByEmailVerificationTokenAsync(string tokenHash, CancellationToken cancellationToken = default);

        Task<User?> GetWithLoginHistoryAsync(Guid userId, int count = 10, CancellationToken cancellationToken = default);

        Task HandleFailedLoginAsync(Guid userId, CancellationToken cancellationToken = default);

        Task<IReadOnlyList<User>> GetByIdsAsync(IEnumerable<Guid> ids, CancellationToken cancellationToken = default);

        /// <summary>
        /// Computes aggregate user statistics in the database (single grouped query) instead
        /// of loading the whole table. The window boundaries are caller-supplied for testability.
        /// </summary>
        Task<UserStatisticsSnapshot> GetStatisticsAsync(
            DateTime todayUtc,
            DateTime weekAgoUtc,
            DateTime monthAgoUtc,
            CancellationToken cancellationToken = default);

        /// <summary>
        /// Returns one page of users with filtering, search, date range, and ordering applied
        /// by the database, plus the total matching count.
        /// </summary>
        Task<(IReadOnlyList<User> Items, int TotalCount)> GetPagedAsync(
            UserListFilter filter,
            CancellationToken cancellationToken = default);
    }
}
