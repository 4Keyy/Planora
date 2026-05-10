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
    }
}
