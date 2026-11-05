using Planora.Auth.Domain.Entities;

namespace Planora.Auth.Domain.Repositories
{
    public interface IAuthUnitOfWork : IUnitOfWork
    {
        IUserRepository Users { get; }

        IRefreshTokenRepository RefreshTokens { get; }

        ILoginHistoryRepository LoginHistory { get; }

        IPasswordHistoryRepository PasswordHistory { get; }

        IUserRecoveryCodeRepository RecoveryCodes { get; }

        Task<bool> TryCommitLoginAsync(
            RefreshToken session,
            string? previousTokenHash,
            string verifiedPasswordHash,
            CancellationToken cancellationToken = default);

        Task<User?> TryResetPasswordAsync(
            Guid userId,
            string expectedTokenHash,
            string passwordHash,
            CancellationToken cancellationToken = default);

        Task<User?> TryChangePasswordAsync(
            Guid userId,
            string verifiedPasswordHash,
            string passwordHash,
            int passwordHistoryLimit,
            CancellationToken cancellationToken = default);

        Task<bool> TryRevokeAllSessionsAsync(
            Guid userId,
            string verifiedPasswordHash,
            string ipAddress,
            CancellationToken cancellationToken = default);

        Task ClearExpiredPasswordResetAsync(
            Guid userId,
            string expectedTokenHash,
            CancellationToken cancellationToken = default);
    }
}
