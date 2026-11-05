using System.Data;
using Npgsql;

namespace Planora.Auth.Infrastructure.Persistence
{
    public sealed class AuthUnitOfWork : IAuthUnitOfWork
    {
        private readonly AuthDbContext _context;
        private IDbContextTransaction? _currentTransaction;

        private IUserRepository? _users;
        private IRefreshTokenRepository? _refreshTokens;
        private ILoginHistoryRepository? _loginHistory;
        private IPasswordHistoryRepository? _passwordHistory;
        private IUserRecoveryCodeRepository? _recoveryCodes;

        public AuthUnitOfWork(AuthDbContext context)
        {
            _context = context;
        }

        public IUserRepository Users =>
            _users ??= new UserRepository(_context);

        public IRefreshTokenRepository RefreshTokens =>
            _refreshTokens ??= new RefreshTokenRepository(_context);

        public ILoginHistoryRepository LoginHistory =>
            _loginHistory ??= new LoginHistoryRepository(_context);

        public IPasswordHistoryRepository PasswordHistory =>
            _passwordHistory ??= new PasswordHistoryRepository(_context);

        public IUserRecoveryCodeRepository RecoveryCodes =>
            _recoveryCodes ??= new UserRecoveryCodeRepository(_context);

        public bool HasActiveTransaction => _currentTransaction != null;

        public async Task<bool> TryCommitLoginAsync(
            RefreshToken session,
            string? previousTokenHash,
            string verifiedPasswordHash,
            CancellationToken cancellationToken = default)
        {
            var strategy = _context.Database.CreateExecutionStrategy();
            try
            {
                var committed = await strategy.ExecuteInTransactionAsync(
                    _context,
                    async (context, token) =>
                    {
                        // Use the same lock order as password reset before changing any session row.
                        await AuthSessionLock.AcquireAsync(context, session.UserId, token);
                        var owner = await context.Database.SqlQuery<int>($"""
                            SELECT 1 AS "Value"
                            FROM public."Users"
                            WHERE "Id" = {session.UserId}
                              AND "PasswordHash" = {verifiedPasswordHash}
                              AND NOT "IsDeleted"
                            FOR NO KEY UPDATE
                            """).ToListAsync(token);
                        if (owner.Count == 0)
                            return false;

                        var now = DateTime.UtcNow;
                        if (previousTokenHash is null)
                        {
                            // The unique index covers all non-revoked rows, including expired ones.
                            await context.RefreshTokens
                                .Where(row => row.UserId == session.UserId &&
                                    row.DeviceFingerprint == session.DeviceFingerprint &&
                                    row.RevokedAt == null && row.ExpiresAt <= now)
                                .ExecuteUpdateAsync(update => update
                                    .SetProperty(row => row.RevokedAt, now)
                                    .SetProperty(row => row.RevokedByIp, session.CreatedByIp)
                                    .SetProperty(row => row.RevokedReason, "Expired session replaced"), token);
                        }
                        else
                        {
                            // Pin the generation validated by the handler until SaveChanges commits.
                            // A competing refresh, logout or login may have changed it since the read.
                            var current = await context.Database.SqlQuery<int>($"""
                                SELECT 1 AS "Value"
                                FROM public."RefreshTokens" AS session
                                WHERE session."Id" = {session.Id}
                                  AND session."Token" = {previousTokenHash}
                                  AND session."RevokedAt" IS NULL
                                  AND session."ExpiresAt" > {now}
                                  AND NOT session."IsDeleted"
                                FOR UPDATE OF session
                                """).ToListAsync(token);
                            if (current.Count == 0)
                                return false;
                        }

                        await context.SaveChangesAsync(acceptAllChangesOnSuccess: false, token);
                        return true;
                    },
                    (context, token) => context.RefreshTokens.AsNoTracking()
                        .AnyAsync(row => row.Id == session.Id && row.Token == session.Token, token),
                    cancellationToken);
                if (committed)
                    _context.ChangeTracker.AcceptAllChanges();

                return committed;
            }
            catch (DbUpdateException ex) when (ex.InnerException is PostgresException
                {
                    SqlState: PostgresErrorCodes.UniqueViolation,
                    ConstraintName: "ix_refresh_tokens_user_device_active"
                })
            {
                return false;
            }
        }

        public async Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
        {
            return await _context.SaveChangesAsync(cancellationToken);
        }

        public Task<User?> TryResetPasswordAsync(
            Guid userId,
            string expectedTokenHash,
            string passwordHash,
            CancellationToken cancellationToken = default) =>
            TryCommitSessionMutationAsync(
                userId,
                (context, token) =>
                {
                    var now = DateTime.UtcNow;
                    return context.Users.FromSqlInterpolated($"""
                        SELECT * FROM public."Users"
                        WHERE "Id" = {userId}
                          AND "PasswordResetToken" = {expectedTokenHash}
                          AND "PasswordResetTokenExpiry" > {now}
                          AND NOT "IsDeleted"
                        FOR NO KEY UPDATE
                        """).SingleOrDefaultAsync(token);
                },
                (_, user, _) =>
                {
                    user.ChangePassword(passwordHash, userId);
                    return Task.CompletedTask;
                },
                (context, token) => HasPasswordAsync(context, userId, passwordHash, token),
                cancellationToken);

        public Task<User?> TryChangePasswordAsync(
            Guid userId,
            string verifiedPasswordHash,
            string passwordHash,
            int passwordHistoryLimit,
            CancellationToken cancellationToken = default) =>
            TryCommitSessionMutationAsync(
                userId,
                (context, token) => LoadPasswordOwnerAsync(context, userId, verifiedPasswordHash, token),
                async (context, user, token) =>
                {
                    var history = await context.PasswordHistory.Where(row => row.UserId == userId).ToListAsync(token);
                    var previousPassword = new PasswordHistory(userId, verifiedPasswordHash);
                    context.PasswordHistory.Add(previousPassword);
                    context.PasswordHistory.RemoveRange(history.Append(previousPassword)
                        .OrderByDescending(row => row.ChangedAt)
                        .ThenByDescending(row => row.Id)
                        .Skip(passwordHistoryLimit));
                    user.ChangePassword(passwordHash, userId);
                },
                (context, token) => HasPasswordAsync(context, userId, passwordHash, token),
                cancellationToken);

        public async Task<bool> TryRevokeAllSessionsAsync(
            Guid userId,
            string verifiedPasswordHash,
            string ipAddress,
            CancellationToken cancellationToken = default)
        {
            var user = await TryCommitSessionMutationAsync(
                userId,
                (context, token) => LoadPasswordOwnerAsync(context, userId, verifiedPasswordHash, token),
                (_, owner, _) =>
                {
                    owner.RevokeAllRefreshTokens(ipAddress);
                    return Task.CompletedTask;
                },
                async (context, token) => !await context.RefreshTokens.AnyAsync(row =>
                    row.UserId == userId && row.RevokedAt == null && row.ExpiresAt > DateTime.UtcNow, token),
                cancellationToken);
            return user is not null;
        }

        private async Task<User?> TryCommitSessionMutationAsync(
            Guid userId,
            Func<AuthDbContext, CancellationToken, Task<User?>> loadLockedUser,
            Func<AuthDbContext, User, CancellationToken, Task> applyMutation,
            Func<AuthDbContext, CancellationToken, Task<bool>> verifySucceeded,
            CancellationToken cancellationToken)
        {
            User? changedUser = null;
            var committed = await _context.Database.CreateExecutionStrategy().ExecuteInTransactionAsync(
                _context,
                async (context, token) =>
                {
                    // A retry must reload the credential and the sessions committed by the preceding lock holder.
                    context.ChangeTracker.Clear();
                    await AuthSessionLock.AcquireAsync(context, userId, token);
                    changedUser = await loadLockedUser(context, token);
                    if (changedUser is null)
                        return false;

                    var now = DateTime.UtcNow;
                    await context.Entry(changedUser).Collection(user => user.RefreshTokens).Query()
                        .Where(row => row.RevokedAt == null && row.ExpiresAt > now)
                        .LoadAsync(token);
                    await applyMutation(context, changedUser, token);
                    await context.SaveChangesAsync(acceptAllChangesOnSuccess: false, token);
                    return true;
                },
                verifySucceeded,
                IsolationLevel.ReadCommitted,
                cancellationToken);

            if (!committed || changedUser is null)
                return null;

            _context.ChangeTracker.AcceptAllChanges();
            var events = changedUser.DomainEvents.ToArray();
            changedUser.ClearDomainEvents();
            await _context.DispatchDomainEventsAsync(events, cancellationToken);
            return changedUser;
        }

        private static Task<User?> LoadPasswordOwnerAsync(
            AuthDbContext context, Guid userId, string verifiedPasswordHash, CancellationToken token) =>
            context.Users.FromSqlInterpolated($"""
                SELECT * FROM public."Users"
                WHERE "Id" = {userId}
                  AND "PasswordHash" = {verifiedPasswordHash}
                  AND NOT "IsDeleted"
                FOR NO KEY UPDATE
                """).SingleOrDefaultAsync(token);

        private static Task<bool> HasPasswordAsync(
            AuthDbContext context, Guid userId, string passwordHash, CancellationToken token) =>
            context.Users.AnyAsync(user => user.Id == userId && user.PasswordHash == passwordHash, token);

        public Task ClearExpiredPasswordResetAsync(
            Guid userId,
            string expectedTokenHash,
            CancellationToken cancellationToken = default)
        {
            var now = DateTime.UtcNow;
            return _context.Users.Where(user => user.Id == userId && user.PasswordResetToken == expectedTokenHash &&
                    (user.PasswordResetTokenExpiry == null || user.PasswordResetTokenExpiry <= now))
                .ExecuteUpdateAsync(update => update
                    .SetProperty(user => user.PasswordResetToken, (string?)null)
                    .SetProperty(user => user.PasswordResetTokenExpiry, (DateTime?)null)
                    .SetProperty(user => user.UpdatedAt, now)
                    .SetProperty(user => user.UpdatedBy, userId), cancellationToken);
        }

        public async Task BeginTransactionAsync(CancellationToken cancellationToken = default)
        {
            if (_currentTransaction != null)
            {
                throw new InvalidOperationException("Transaction already started");
            }

            _currentTransaction = await _context.Database.BeginTransactionAsync(cancellationToken);
        }

        public async Task CommitTransactionAsync(CancellationToken cancellationToken = default)
        {
            if (_currentTransaction == null)
            {
                throw new InvalidOperationException("No active transaction");
            }

            try
            {
                await _context.SaveChangesAsync(cancellationToken);
                await _currentTransaction.CommitAsync(cancellationToken);
            }
            catch
            {
                await RollbackTransactionAsync(cancellationToken);
                throw;
            }
            finally
            {
                _currentTransaction?.Dispose();
                _currentTransaction = null;
            }
        }

        public async Task RollbackTransactionAsync(CancellationToken cancellationToken = default)
        {
            if (_currentTransaction == null)
            {
                throw new InvalidOperationException("No active transaction");
            }

            try
            {
                await _currentTransaction.RollbackAsync(cancellationToken);
            }
            finally
            {
                _currentTransaction?.Dispose();
                _currentTransaction = null;
            }
        }

        public void Dispose()
        {
            _currentTransaction?.Dispose();
            _context.Dispose();
        }
    }
}
