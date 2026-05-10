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

        public bool HasActiveTransaction => _currentTransaction != null;

        public async Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
        {
            return await _context.SaveChangesAsync(cancellationToken);
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
