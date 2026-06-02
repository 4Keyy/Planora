using Microsoft.Extensions.Hosting;

namespace Planora.Messaging.Infrastructure.BackgroundJobs
{
    public sealed class OutboxProcessorJob : BackgroundService
    {
        private readonly IServiceProvider _serviceProvider;
        private readonly ILogger<OutboxProcessorJob> _logger;
        // 5 s (was 30 s) to keep message delivery near-live, matching the shared
        // BuildingBlocks OutboxProcessor cadence. The query is indexed and bounded.
        private readonly TimeSpan _interval = TimeSpan.FromSeconds(5);

        public OutboxProcessorJob(
            IServiceProvider serviceProvider,
            ILogger<OutboxProcessorJob> logger)
        {
            _serviceProvider = serviceProvider;
            _logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            _logger.LogInformation("📤 Outbox Processor started");

            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    await Task.Delay(_interval, stoppingToken);

                    using var scope = _serviceProvider.CreateScope();
                    var outboxProcessor = scope.ServiceProvider.GetRequiredService<IOutboxProcessor>();

                    await outboxProcessor.ProcessPendingMessagesAsync(stoppingToken);
                }
                catch (OperationCanceledException)
                {
                    // Ожидаемое исключение при остановке
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "❌ Error in Outbox Processor");
                }
            }

            _logger.LogInformation("🛑 Outbox Processor stopped");
        }
    }
}
