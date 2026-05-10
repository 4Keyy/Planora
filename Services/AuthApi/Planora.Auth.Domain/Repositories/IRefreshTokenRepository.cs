using Planora.Auth.Domain.Entities;

namespace Planora.Auth.Domain.Repositories
{
    public interface IRefreshTokenRepository : IRepository<RefreshToken>
    {
        Task<RefreshToken?> GetByTokenAsync(string token, CancellationToken cancellationToken = default);

        Task<IReadOnlyList<RefreshToken>> GetActiveTokensByUserIdAsync(Guid userId, CancellationToken cancellationToken = default);

        Task DeleteExpiredTokensAsync(DateTime olderThan, CancellationToken cancellationToken = default);

        /// <summary>
        /// Returns the active (non-revoked, non-expired) token for the given user and device
        /// fingerprint, or null if no such session exists yet.
        /// Used to implement session deduplication on re-login.
        /// </summary>
        Task<RefreshToken?> FindActiveByUserAndDeviceAsync(
            Guid userId,
            string deviceFingerprint,
            CancellationToken cancellationToken = default);
    }
}
