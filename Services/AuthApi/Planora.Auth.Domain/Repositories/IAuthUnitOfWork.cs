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
            CancellationToken cancellationToken = default);

        Task<User?> TryResetPasswordAsync(
            Guid userId,
            string expectedTokenHash,
            string passwordHash,
            CancellationToken cancellationToken = default);

        Task ClearExpiredPasswordResetAsync(
            Guid userId,
            string expectedTokenHash,
            CancellationToken cancellationToken = default);
    }
}
