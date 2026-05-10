using Planora.Auth.Domain.Entities;
using Planora.Auth.Domain.Events;

namespace Planora.Auth.Infrastructure.Persistence.Repositories
{
    public sealed class UserRepository : BaseRepository<User>, IUserRepository
    {
        public UserRepository(AuthDbContext context) : base(context)
        {
        }

        public async Task<User?> GetByEmailAsync(Email email, CancellationToken cancellationToken = default)
        {
            return await _context.Users
                .FirstOrDefaultAsync(u => u.Email.Value == email.Value, cancellationToken);
        }

        public async Task<bool> ExistsByEmailAsync(Email email, CancellationToken cancellationToken = default)
        {
            return await _context.Users
                .AnyAsync(u => u.Email.Value == email.Value, cancellationToken);
        }

        public async Task<User?> GetWithRefreshTokensAsync(Guid userId, CancellationToken cancellationToken = default)
        {
            return await _context.Users
                .Include(u => u.RefreshTokens)
                .FirstOrDefaultAsync(u => u.Id == userId, cancellationToken);
        }

        public async Task<User?> GetByRefreshTokenAsync(string refreshToken, CancellationToken cancellationToken = default)
        {
            return await _context.Users
                .Include(u => u.RefreshTokens)
                .FirstOrDefaultAsync(u => u.RefreshTokens.Any(rt => rt.Token == refreshToken), cancellationToken);
        }

        public async Task<User?> GetByPasswordResetTokenAsync(string tokenHash, CancellationToken cancellationToken = default)
        {
            return await _context.Users
                .Include(u => u.RefreshTokens)
                .FirstOrDefaultAsync(u => u.PasswordResetToken == tokenHash, cancellationToken);
        }

        public async Task<User?> GetByEmailVerificationTokenAsync(string tokenHash, CancellationToken cancellationToken = default)
        {
            return await _context.Users
                .FirstOrDefaultAsync(u => u.EmailVerificationToken == tokenHash, cancellationToken);
        }

        public async Task<User?> GetWithLoginHistoryAsync(Guid userId, int count = 10, CancellationToken cancellationToken = default)
        {
            var user = await _context.Users
                .FirstOrDefaultAsync(u => u.Id == userId, cancellationToken);

            if (user != null)
            {
                await _context.Entry(user)
                    .Collection(u => u.LoginHistory)
                    .Query()
                    .OrderByDescending(lh => lh.LoginAt)
                    .Take(count)
                    .LoadAsync(cancellationToken);
            }

            return user;
        }

        public async Task HandleFailedLoginAsync(Guid userId, CancellationToken cancellationToken = default)
        {
            var user = await _context.Users.FindAsync(new object[] { userId }, cancellationToken);
            if (user == null) return;

            user.IncrementFailedLoginAttempts();
            if (user.FailedLoginAttempts >= 5)
            {
                user.LockAccount();
            }

            await _context.SaveChangesAsync(cancellationToken);
        }
    }
}
