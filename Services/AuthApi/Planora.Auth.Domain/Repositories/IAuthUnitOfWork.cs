namespace Planora.Auth.Domain.Repositories
{
    public interface IAuthUnitOfWork : IUnitOfWork
    {
        IUserRepository Users { get; }

        IRefreshTokenRepository RefreshTokens { get; }

        ILoginHistoryRepository LoginHistory { get; }

        IPasswordHistoryRepository PasswordHistory { get; }
    }
}
