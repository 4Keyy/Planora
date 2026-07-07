using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Planora.BuildingBlocks.Infrastructure.Retention;
using Planora.Realtime.Domain.Entities;

namespace Planora.Realtime.Infrastructure.Retention
{
    /// <summary>
    /// Purges notifications the recipient has already read, <see cref="RetentionOptions.ReadNotificationDays"/>
    /// after they read them (default 3). Read notifications are transient UI state — once seen and a few
    /// days old they no longer earn their storage.
    /// </summary>
    public sealed class ReadNotificationPurgePolicy : IRetentionPolicy
    {
        private readonly IRetentionLock _lock;
        private readonly ILogger<ReadNotificationPurgePolicy> _logger;

        public ReadNotificationPurgePolicy(IRetentionLock retentionLock, ILogger<ReadNotificationPurgePolicy> logger)
        {
            _lock = retentionLock;
            _logger = logger;
        }

        public string Name => "read-notification-purge";

        public bool IsEnabled(RetentionOptions options) => options.PurgeReadNotifications;

        public Task<RetentionResult> ExecuteAsync(IServiceProvider scopedServices, RetentionContext context, CancellationToken cancellationToken)
        {
            var db = scopedServices.GetRequiredService<DbContext>();
            var cutoff = context.UtcNow.AddDays(-context.Options.ReadNotificationDays);

            return RetentionExecutor.RunAsync(
                Name, db, _lock, context,
                ct => db.Set<Notification>().IgnoreQueryFilters()
                    .CountAsync(n => n.IsRead && n.ReadAtUtc < cutoff, ct),
                (batch, ct) => RetentionExecutor.DeleteBatchByIdAsync<Notification>(
                    db, n => n.IsRead && n.ReadAtUtc < cutoff, batch, ct),
                _logger, cancellationToken);
        }
    }

    /// <summary>
    /// Purges notifications the recipient never read once they are older than
    /// <see cref="RetentionOptions.UnreadNotificationDays"/> (default 90) — the safety valve against an
    /// unbounded backlog of stale unread rows for inactive users.
    /// </summary>
    public sealed class UnreadNotificationPurgePolicy : IRetentionPolicy
    {
        private readonly IRetentionLock _lock;
        private readonly ILogger<UnreadNotificationPurgePolicy> _logger;

        public UnreadNotificationPurgePolicy(IRetentionLock retentionLock, ILogger<UnreadNotificationPurgePolicy> logger)
        {
            _lock = retentionLock;
            _logger = logger;
        }

        public string Name => "unread-notification-purge";

        public bool IsEnabled(RetentionOptions options) => options.PurgeUnreadNotifications;

        public Task<RetentionResult> ExecuteAsync(IServiceProvider scopedServices, RetentionContext context, CancellationToken cancellationToken)
        {
            var db = scopedServices.GetRequiredService<DbContext>();
            var cutoff = context.UtcNow.AddDays(-context.Options.UnreadNotificationDays);

            return RetentionExecutor.RunAsync(
                Name, db, _lock, context,
                ct => db.Set<Notification>().IgnoreQueryFilters()
                    .CountAsync(n => !n.IsRead && n.OccurredOnUtc < cutoff, ct),
                (batch, ct) => RetentionExecutor.DeleteBatchByIdAsync<Notification>(
                    db, n => !n.IsRead && n.OccurredOnUtc < cutoff, batch, ct),
                _logger, cancellationToken);
        }
    }

    /// <summary>
    /// Purges delivery-attempt audit rows that were successfully delivered more than
    /// <see cref="RetentionOptions.NotificationDeliveryDays"/> ago (default 30). Pending/failed rows (no
    /// <c>DeliveredAtUtc</c>) are kept for diagnostics.
    /// </summary>
    public sealed class NotificationDeliveryPurgePolicy : IRetentionPolicy
    {
        private readonly IRetentionLock _lock;
        private readonly ILogger<NotificationDeliveryPurgePolicy> _logger;

        public NotificationDeliveryPurgePolicy(IRetentionLock retentionLock, ILogger<NotificationDeliveryPurgePolicy> logger)
        {
            _lock = retentionLock;
            _logger = logger;
        }

        public string Name => "notification-delivery-purge";

        public bool IsEnabled(RetentionOptions options) => options.PurgeNotificationDeliveries;

        public Task<RetentionResult> ExecuteAsync(IServiceProvider scopedServices, RetentionContext context, CancellationToken cancellationToken)
        {
            var db = scopedServices.GetRequiredService<DbContext>();
            var cutoff = context.UtcNow.AddDays(-context.Options.NotificationDeliveryDays);

            return RetentionExecutor.RunAsync(
                Name, db, _lock, context,
                ct => db.Set<NotificationDelivery>().IgnoreQueryFilters()
                    .CountAsync(d => d.DeliveredAtUtc != null && d.DeliveredAtUtc < cutoff, ct),
                (batch, ct) => RetentionExecutor.DeleteBatchByIdAsync<NotificationDelivery>(
                    db, d => d.DeliveredAtUtc != null && d.DeliveredAtUtc < cutoff, batch, ct),
                _logger, cancellationToken);
        }
    }
}
