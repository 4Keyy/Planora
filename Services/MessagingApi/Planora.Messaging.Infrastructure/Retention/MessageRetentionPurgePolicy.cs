using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Planora.BuildingBlocks.Infrastructure.Retention;
using Planora.Messaging.Domain.Entities;

namespace Planora.Messaging.Infrastructure.Retention
{
    /// <summary>
    /// Purges messages older than <see cref="RetentionOptions.MessageDays"/> (default 365). Messages have no
    /// soft-delete today, so without this they grow without bound — but they are also <b>user content</b>,
    /// so this ships <b>opt-in</b> (<see cref="RetentionOptions.PurgeMessages"/> defaults to false): deleting
    /// a user's conversation history is a product decision, not something that happens by simply enabling the
    /// retention subsystem. The existing <c>(CreatedAt)</c> index covers the scan.
    /// </summary>
    public sealed class MessageRetentionPurgePolicy : IRetentionPolicy
    {
        private readonly IRetentionLock _lock;
        private readonly ILogger<MessageRetentionPurgePolicy> _logger;

        public MessageRetentionPurgePolicy(IRetentionLock retentionLock, ILogger<MessageRetentionPurgePolicy> logger)
        {
            _lock = retentionLock;
            _logger = logger;
        }

        public string Name => "message-purge";

        public bool IsEnabled(RetentionOptions options) => options.PurgeMessages;

        public Task<RetentionResult> ExecuteAsync(IServiceProvider scopedServices, RetentionContext context, CancellationToken cancellationToken)
        {
            var db = scopedServices.GetRequiredService<DbContext>();
            var cutoff = context.UtcNow.AddDays(-context.Options.MessageDays);

            return RetentionExecutor.RunAsync(
                Name, db, _lock, context,
                ct => RetentionExecutor.CountAsync<Message>(db, m => m.CreatedAt < cutoff, ct),
                (batch, ct) => RetentionExecutor.DeleteBatchByIdAsync<Message>(db, m => m.CreatedAt < cutoff, batch, ct),
                _logger, cancellationToken);
        }
    }
}
