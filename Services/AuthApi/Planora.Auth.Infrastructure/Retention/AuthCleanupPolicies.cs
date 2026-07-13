using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Planora.Auth.Domain.Entities;
using Planora.Auth.Domain.Enums;
using Planora.BuildingBlocks.Infrastructure.Retention;

namespace Planora.Auth.Infrastructure.Retention
{
    /// <summary>
    /// Purges <b>terminal</b> friendship rows — Rejected, Cancelled or Removed — once their last transition
    /// is older than <see cref="RetentionOptions.FriendshipTerminalDays"/> (default 90). Active (Accepted)
    /// and pending requests are never touched. These dead historical rows otherwise accumulate forever.
    /// Ships <b>opt-in</b> (<see cref="RetentionOptions.PurgeFriendships"/> defaults to false) because a
    /// removed/rejected record is arguably user-meaningful history.
    /// </summary>
    public sealed class FriendshipTerminalPurgePolicy : IRetentionPolicy
    {
        private readonly IRetentionLock _lock;
        private readonly ILogger<FriendshipTerminalPurgePolicy> _logger;

        public FriendshipTerminalPurgePolicy(IRetentionLock retentionLock, ILogger<FriendshipTerminalPurgePolicy> logger)
        {
            _lock = retentionLock;
            _logger = logger;
        }

        public string Name => "friendship-terminal-purge";

        public bool IsEnabled(RetentionOptions options) => options.PurgeFriendships;

        public Task<RetentionResult> ExecuteAsync(IServiceProvider scopedServices, RetentionContext context, CancellationToken cancellationToken)
        {
            var db = scopedServices.GetRequiredService<DbContext>();
            var cutoff = context.UtcNow.AddDays(-context.Options.FriendshipTerminalDays);

            // Age from the last transition (UpdatedAt, set on Reject/Cancel/Remove); fall back to CreatedAt.
            System.Linq.Expressions.Expression<Func<Friendship, bool>> eligible =
                f => (f.Status == FriendshipStatus.Rejected
                      || f.Status == FriendshipStatus.Cancelled
                      || f.Status == FriendshipStatus.Removed)
                     && (f.UpdatedAt ?? f.CreatedAt) < cutoff;

            return RetentionExecutor.RunAsync(
                Name, db, _lock, context,
                ct => RetentionExecutor.CountAsync(db, eligible, ct),
                (batch, ct) => RetentionExecutor.DeleteBatchByIdAsync(db, eligible, batch, ct),
                _logger, cancellationToken);
        }
    }

    /// <summary>
    /// Purges spent (already-used) two-factor recovery codes older than
    /// <see cref="RetentionOptions.RecoveryCodeUsedDays"/> (default 30). A used code can never be redeemed
    /// again, so the row is pure dead weight; unused codes are always kept. Enabled by default — this is
    /// unambiguously safe housekeeping.
    /// </summary>
    public sealed class UsedRecoveryCodePurgePolicy : IRetentionPolicy
    {
        private readonly IRetentionLock _lock;
        private readonly ILogger<UsedRecoveryCodePurgePolicy> _logger;

        public UsedRecoveryCodePurgePolicy(IRetentionLock retentionLock, ILogger<UsedRecoveryCodePurgePolicy> logger)
        {
            _lock = retentionLock;
            _logger = logger;
        }

        public string Name => "used-recovery-code-purge";

        public bool IsEnabled(RetentionOptions options) => options.PurgeUsedRecoveryCodes;

        public Task<RetentionResult> ExecuteAsync(IServiceProvider scopedServices, RetentionContext context, CancellationToken cancellationToken)
        {
            var db = scopedServices.GetRequiredService<DbContext>();
            var cutoff = context.UtcNow.AddDays(-context.Options.RecoveryCodeUsedDays);

            return RetentionExecutor.RunAsync(
                Name, db, _lock, context,
                ct => RetentionExecutor.CountAsync<UserRecoveryCode>(db, c => c.IsUsed && c.UsedAt < cutoff, ct),
                (batch, ct) => RetentionExecutor.DeleteBatchByIdAsync<UserRecoveryCode>(db, c => c.IsUsed && c.UsedAt < cutoff, batch, ct),
                _logger, cancellationToken);
        }
    }
}
