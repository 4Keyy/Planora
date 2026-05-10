using Microsoft.Extensions.Hosting;

namespace Planora.Messaging.Infrastructure.BackgroundJobs
{
    public sealed class InboxCleanupJob : BackgroundService
    {
        private readonly IServiceProvider _serviceProvider;
        private readonly ILogger<InboxCleanupJob> _logger;
        private readonly TimeSpan _interval = TimeSpan.FromHours(12);

        public InboxCleanupJob(
            IServiceProvider serviceProvider,
            ILogger<InboxCleanupJob> logger)
        {
            _serviceProvider = serviceProvider;
            _logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            _logger.LogInformation("🧹 Inbox Cleanup Job started");

            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    await Task.Delay(_interval, stoppingToken);

                    using var scope = _serviceProvider.CreateScope();
                    var inboxRepo = scope.ServiceProvider
                        .GetRequiredService<IInboxRepository>();

                    var retentionCutoff = DateTime.UtcNow.AddDays(-7);
                    await inboxRepo.DeleteProcessedMessagesAsync(
                        retentionCutoff,
                        stoppingToken);

                    _logger.LogInformation(
                        "✅ Inbox cleanup completed, deleted messages older than {Cutoff}",
                        retentionCutoff);
                }
                catch (OperationCanceledException)
                {
                    // Expected when stopping
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "❌ Error in Inbox Cleanup Job");
                }
            }

            _logger.LogInformation("🛑 Inbox Cleanup Job stopped");
        }
    }
}
