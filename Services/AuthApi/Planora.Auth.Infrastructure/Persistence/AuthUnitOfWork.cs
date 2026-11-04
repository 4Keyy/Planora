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
            CancellationToken cancellationToken = default)
        {
            var strategy = _context.Database.CreateExecutionStrategy();
            try
            {
                var committed = await strategy.ExecuteInTransactionAsync(
                    _context,
                    async (context, token) =>
                    {
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
                                  AND EXISTS (
                                    SELECT 1 FROM public."Users" AS owner
                                    WHERE owner."Id" = session."UserId" AND NOT owner."IsDeleted"
                                  )
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

        public async Task<User?> TryResetPasswordAsync(
            Guid userId,
            string expectedTokenHash,
            string passwordHash,
            CancellationToken cancellationToken = default)
        {
            User? changedUser = null;
            var committed = await _context.Database.CreateExecutionStrategy().ExecuteInTransactionAsync(
                _context,
                async (context, token) =>
                {
                    // Each attempt reloads the reset target and its sessions from the database.
                    context.ChangeTracker.Clear();
                    await AuthSessionLock.AcquireAsync(context, userId, token);
                    var now = DateTime.UtcNow;
                    changedUser = await context.Users.FromSqlInterpolated($"""
                        SELECT * FROM public."Users"
                        WHERE "Id" = {userId}
                          AND "PasswordResetToken" = {expectedTokenHash}
                          AND "PasswordResetTokenExpiry" > {now}
                          AND NOT "IsDeleted"
                        FOR NO KEY UPDATE
                        """).SingleOrDefaultAsync(token);
                    if (changedUser is null)
                        return false;

                    await context.Entry(changedUser).Collection(user => user.RefreshTokens).LoadAsync(token);
                    changedUser.ChangePassword(passwordHash, userId);
                    await context.SaveChangesAsync(acceptAllChangesOnSuccess: false, token);
                    return true;
                },
                (context, token) => context.Users.AsNoTracking()
                    .AnyAsync(user => user.Id == userId && user.PasswordHash == passwordHash, token),
                cancellationToken);

            if (!committed || changedUser is null)
                return null;

            _context.ChangeTracker.AcceptAllChanges();
            var events = changedUser.DomainEvents.ToArray();
            changedUser.ClearDomainEvents();
            await _context.DispatchDomainEventsAsync(events, cancellationToken);
            return changedUser;
        }

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
