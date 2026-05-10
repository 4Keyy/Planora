namespace Planora.BuildingBlocks.Infrastructure.Outbox
{
    public sealed class OutboxProcessor : BackgroundService
    {
        private readonly IServiceProvider _serviceProvider;
        private readonly ILogger<OutboxProcessor> _logger;
        private readonly TimeSpan _interval = TimeSpan.FromSeconds(30);

        public OutboxProcessor(
            IServiceProvider serviceProvider,
            ILogger<OutboxProcessor> logger)
        {
            _serviceProvider = serviceProvider;
            _logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            _logger.LogInformation("Outbox Processor started");

            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    await ProcessOutboxMessagesAsync(stoppingToken);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error processing outbox messages");
                }

                await Task.Delay(_interval, stoppingToken);
            }

            _logger.LogInformation("Outbox Processor stopped");
        }

        private async Task ProcessOutboxMessagesAsync(CancellationToken cancellationToken)
        {
            using var scope = _serviceProvider.CreateScope();

            var dbContext = scope.ServiceProvider.GetService<DbContext>();
            if (dbContext == null)
            {
                _logger.LogWarning("DbContext not found in DI container");
                return;
            }

            var eventBus = scope.ServiceProvider.GetRequiredService<IEventBus>();

            var messages = await dbContext.Set<OutboxMessage>()
                .Where(m => m.Status == OutboxMessageStatus.Pending ||
                           (m.Status == OutboxMessageStatus.Failed && m.NextRetryUtc <= DateTime.UtcNow))
                .OrderBy(m => m.OccurredOnUtc)
                .Take(20)
                .ToListAsync(cancellationToken);

            foreach (var message in messages)
            {
                try
                {
                    message.MarkAsProcessing();
                    await dbContext.SaveChangesAsync(cancellationToken);

                    var eventType = Type.GetType(message.Type);
                    if (eventType == null)
                    {
                        _logger.LogError("Event type {Type} not found", message.Type);
                        message.MarkAsFailed($"Event type {message.Type} not found");
                        await dbContext.SaveChangesAsync(cancellationToken);
                        continue;
                    }

                    var @event = JsonSerializer.Deserialize(message.Content, eventType);
                    if (@event == null)
                    {
                        _logger.LogError("Failed to deserialize event {Type}", message.Type);
                        message.MarkAsFailed("Deserialization failed");
                        await dbContext.SaveChangesAsync(cancellationToken);
                        continue;
                    }

                    var publishMethod = typeof(IEventBus)
                        .GetMethod(nameof(IEventBus.PublishAsync))!
                        .MakeGenericMethod(eventType);

                    await (Task)publishMethod.Invoke(eventBus, new[] { @event, cancellationToken })!;

                    message.MarkAsProcessed();
                    await dbContext.SaveChangesAsync(cancellationToken);

                    _logger.LogInformation("Processed outbox message {MessageId} of type {Type}", message.Id, message.Type);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error processing outbox message {MessageId}", message.Id);

                    if (message.CanRetry)
                    {
                        message.MarkAsFailed(ex.Message);
                    }
                    else
                    {
                        _logger.LogError("Max retries reached for outbox message {MessageId}", message.Id);
                        message.MarkAsFailed($"Max retries exceeded: {ex.Message}");
                    }

                    await dbContext.SaveChangesAsync(cancellationToken);
                }
            }
        }
    }
}