using Planora.Auth.Domain.Entities;
using Planora.Auth.Domain.ValueObjects;

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

        Task<User?> TryResetPasswordAsync(
            Guid userId,
            string expectedTokenHash,
            string passwordHash,
            Func<CancellationToken, Task> beforeCommit,
            CancellationToken cancellationToken = default);

        Task<User?> TryChangePasswordAsync(
            Guid userId,
            string verifiedPasswordHash,
            string passwordHash,
            int passwordHistoryLimit,
            CancellationToken cancellationToken = default);

        Task<User?> TryChangePasswordAsync(
            Guid userId,
            string verifiedPasswordHash,
            string passwordHash,
            int passwordHistoryLimit,
            Func<CancellationToken, Task> beforeCommit,
            CancellationToken cancellationToken = default);

        Task<bool> TryRevokeAllSessionsAsync(
            Guid userId,
            string verifiedPasswordHash,
            string ipAddress,
            CancellationToken cancellationToken = default);

        Task<bool> TryRevokeAllSessionsAsync(
            Guid userId,
            string verifiedPasswordHash,
            string ipAddress,
            Func<CancellationToken, Task> beforeCommit,
            CancellationToken cancellationToken = default);

        Task ClearExpiredPasswordResetAsync(
            Guid userId,
            string expectedTokenHash,
            CancellationToken cancellationToken = default);

        Task<User?> TryChangeEmailAsync(
            Guid userId,
            string verifiedPasswordHash,
            Email email,
            string verificationTokenHash,
            DateTime verificationTokenExpiry,
            Func<CancellationToken, Task> beforeCommit,
            CancellationToken cancellationToken = default);

        Task<User?> TryDisableTwoFactorAsync(
            Guid userId,
            string verifiedPasswordHash,
            Func<CancellationToken, Task> beforeCommit,
            CancellationToken cancellationToken = default);

        Task<User?> TryDeleteUserAsync(
            Guid userId,
            string verifiedPasswordHash,
            Func<User, CancellationToken, Task> stageDeletion,
            Func<CancellationToken, Task> beforeCommit,
            CancellationToken cancellationToken = default);
    }
}
