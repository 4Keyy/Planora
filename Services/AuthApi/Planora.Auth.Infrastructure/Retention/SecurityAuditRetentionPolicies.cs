using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Planora.Auth.Domain.Entities;
using Planora.Auth.Infrastructure.Auditing;
using Planora.BuildingBlocks.Infrastructure.Retention;

namespace Planora.Auth.Infrastructure.Retention
{
    /// <summary>
    /// Purges login-history rows older than <see cref="RetentionOptions.LoginHistoryDays"/> (default 180).
    /// This is security-forensics data, so it is kept far longer than user content and is <b>opt-in</b>
    /// (<see cref="RetentionOptions.PurgeLoginHistory"/> defaults to false) — enabling it is a deliberate
    /// compliance decision. The existing <c>(LoginAt)</c> index covers the scan.
    /// </summary>
    public sealed class LoginHistoryPurgePolicy : IRetentionPolicy
    {
        private readonly IRetentionLock _lock;
        private readonly ILogger<LoginHistoryPurgePolicy> _logger;

        public LoginHistoryPurgePolicy(IRetentionLock retentionLock, ILogger<LoginHistoryPurgePolicy> logger)
        {
            _lock = retentionLock;
            _logger = logger;
        }

        public string Name => "login-history-purge";

        public bool IsEnabled(RetentionOptions options) => options.PurgeLoginHistory;

        public Task<RetentionResult> ExecuteAsync(IServiceProvider scopedServices, RetentionContext context, CancellationToken cancellationToken)
        {
            var db = scopedServices.GetRequiredService<DbContext>();
            var cutoff = context.UtcNow.AddDays(-context.Options.LoginHistoryDays);

            return RetentionExecutor.RunAsync(
                Name, db, _lock, context,
                ct => RetentionExecutor.CountAsync<LoginHistory>(db, lh => lh.LoginAt < cutoff, ct),
                (batch, ct) => RetentionExecutor.DeleteBatchByIdAsync<LoginHistory>(db, lh => lh.LoginAt < cutoff, batch, ct),
                _logger, cancellationToken);
        }
    }

    /// <summary>
    /// Purges audit-log rows older than <see cref="RetentionOptions.AuditLogDays"/> (default 365). Like
    /// login history this is forensics data, kept a full year and <b>opt-in</b>
    /// (<see cref="RetentionOptions.PurgeAuditLogs"/> defaults to false). The existing <c>(CreatedAt)</c>
    /// index covers the scan.
    /// </summary>
    public sealed class AuditLogPurgePolicy : IRetentionPolicy
    {
        private readonly IRetentionLock _lock;
        private readonly ILogger<AuditLogPurgePolicy> _logger;

        public AuditLogPurgePolicy(IRetentionLock retentionLock, ILogger<AuditLogPurgePolicy> logger)
        {
            _lock = retentionLock;
            _logger = logger;
        }

        public string Name => "audit-log-purge";

        public bool IsEnabled(RetentionOptions options) => options.PurgeAuditLogs;

        public Task<RetentionResult> ExecuteAsync(IServiceProvider scopedServices, RetentionContext context, CancellationToken cancellationToken)
        {
            var db = scopedServices.GetRequiredService<DbContext>();
            var cutoff = context.UtcNow.AddDays(-context.Options.AuditLogDays);

            return RetentionExecutor.RunAsync(
                Name, db, _lock, context,
                ct => RetentionExecutor.CountAsync<AuditLog>(db, a => a.CreatedAt < cutoff, ct),
                (batch, ct) => RetentionExecutor.DeleteBatchByIdAsync<AuditLog>(db, a => a.CreatedAt < cutoff, batch, ct),
                _logger, cancellationToken);
        }
    }
}
