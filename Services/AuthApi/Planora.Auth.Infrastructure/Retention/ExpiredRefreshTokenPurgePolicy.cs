using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Planora.Auth.Domain.Entities;
using Planora.BuildingBlocks.Infrastructure.Retention;

namespace Planora.Auth.Infrastructure.Retention
{
    /// <summary>
    /// Physically deletes refresh tokens whose <see cref="RefreshToken.ExpiresAt"/> is more than
    /// <see cref="RetentionOptions.ExpiredRefreshTokenDays"/> in the past (default 30). Token rotation
    /// mints a new row on every refresh and never removes the old ones, so this is the only thing that
    /// stops the <c>RefreshTokens</c> table growing without bound. The grace past expiry keeps a recently
    /// expired token queryable for the session list / security overview before it is reaped.
    /// </summary>
    public sealed class ExpiredRefreshTokenPurgePolicy : IRetentionPolicy
    {
        private readonly IRetentionLock _lock;
        private readonly ILogger<ExpiredRefreshTokenPurgePolicy> _logger;

        public ExpiredRefreshTokenPurgePolicy(IRetentionLock retentionLock, ILogger<ExpiredRefreshTokenPurgePolicy> logger)
        {
            _lock = retentionLock;
            _logger = logger;
        }

        public string Name => "expired-refresh-token-purge";

        public bool IsEnabled(RetentionOptions options) => options.PurgeExpiredRefreshTokens;

        public Task<RetentionResult> ExecuteAsync(
            IServiceProvider scopedServices,
            RetentionContext context,
            CancellationToken cancellationToken)
        {
            var db = scopedServices.GetRequiredService<DbContext>();
            var cutoff = context.UtcNow.AddDays(-context.Options.ExpiredRefreshTokenDays);

            return RetentionExecutor.RunAsync(
                Name, db, _lock, context,
                ct => RetentionExecutor.CountAsync<RefreshToken>(db, t => t.ExpiresAt < cutoff, ct),
                (batch, ct) => RetentionExecutor.DeleteBatchByIdAsync<RefreshToken>(db, t => t.ExpiresAt < cutoff, batch, ct),
                _logger, cancellationToken);
        }
    }
}
