using System.Diagnostics;
using Planora.BuildingBlocks.Infrastructure.Observability;

namespace Planora.BuildingBlocks.Infrastructure.Outbox
{
    public sealed class OutboxProcessor : BackgroundService
    {
        private readonly IServiceProvider _serviceProvider;
        private readonly ILogger<OutboxProcessor> _logger;
        // Idle poll cadence — the safety net. The fast path is event-driven: an OutboxSignal
        // pulse (raised by OutboxNotifyInterceptor the instant an outbox row commits) wakes the
        // loop in milliseconds, so a freshly produced task-lifecycle event reaches its
        // Collaboration "ветка" system comment almost immediately rather than after a poll tick.
        // When no signal is registered (services that opted out) the loop falls back to pure
        // polling at this cadence. Kept short so the indexed Take(BatchSize) query stays cheap.
        private readonly TimeSpan _interval = TimeSpan.FromSeconds(5);
        private const int BatchSize = 20;

        // Optional: present in services that wired immediate dispatch. Null elsewhere → pure poll.
        private readonly OutboxSignal? _signal;

        public OutboxProcessor(
            IServiceProvider serviceProvider,
            ILogger<OutboxProcessor> logger)
        {
            _serviceProvider = serviceProvider;
            _logger = logger;
            _signal = serviceProvider.GetService<OutboxSignal>();
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            _logger.LogInformation(
                "Outbox Processor started ({Mode})",
                _signal is null ? "poll" : "signal + poll fallback");

            while (!stoppingToken.IsCancellationRequested)
            {
                int processed = 0;
                try
                {
                    processed = await ProcessOutboxMessagesAsync(stoppingToken);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error processing outbox messages");
                }

                // A full batch likely means more rows are waiting — drain immediately
                // without idling so a burst clears in one tight loop.
                if (processed >= BatchSize)
                    continue;

                if (_signal is not null)
                    await _signal.WaitAsync(_interval, stoppingToken);
                else
                    await Task.Delay(_interval, stoppingToken);
            }

            _logger.LogInformation("Outbox Processor stopped");
        }

        private async Task<int> ProcessOutboxMessagesAsync(CancellationToken cancellationToken)
        {
            using var scope = _serviceProvider.CreateScope();

            var dbContext = scope.ServiceProvider.GetService<DbContext>();
            if (dbContext == null)
            {
                _logger.LogWarning("DbContext not found in DI container");
                return 0;
            }

            var eventBus = scope.ServiceProvider.GetRequiredService<IEventBus>();

            // Observability: capture wall-clock duration of one outbox pass; emitted at the end
            // of this method regardless of how many messages are in the batch.
            var batchStopwatch = Stopwatch.StartNew();

            // Delivery semantics: AT-LEAST-ONCE. A message can be re-published if the process crashes
            // after the broker publish but before the row is marked Processed, so every consumer MUST
            // be idempotent (the inbox de-duplicates by event id). This claim-free SELECT assumes a
            // SINGLE active processor instance per service (the default deployment): two instances would
            // both pick up the same Pending rows and double-publish. To scale the processor horizontally,
            // claim a batch atomically first — e.g. `SELECT ... FOR UPDATE SKIP LOCKED` (raw SQL) or a
            // guarded `UPDATE ... SET Status = Processing ... RETURNING` — so each row is owned by exactly
            // one worker. See docs/architecture.md (Outbox) for the rationale.
            var messages = await dbContext.Set<OutboxMessage>()
                .Where(m => m.Status == OutboxMessageStatus.Pending ||
                           (m.Status == OutboxMessageStatus.Failed && m.NextRetryUtc <= DateTime.UtcNow))
                .OrderBy(m => m.OccurredOnUtc)
                .Take(BatchSize)
                .ToListAsync(cancellationToken);

            foreach (var message in messages)
            {
                // Backpressure signal: how long this message has been waiting since it was produced.
                var lagSeconds = Math.Max(0, (DateTime.UtcNow - message.OccurredOnUtc).TotalSeconds);
                PlanoraMetrics.OutboxMessageAge.Record(lagSeconds);

                try
                {
                    message.MarkAsProcessing();
                    await dbContext.SaveChangesAsync(cancellationToken);

                    var eventType = Type.GetType(message.Type);
                    if (eventType == null)
                    {
                        _logger.LogError("Event type {Type} not found", message.Type);
                        // Non-recoverable: the assembly that defines this type either does
                        // not ship with the current processor build, or the FQN was renamed.
                        // Re-trying will fail identically — dead-letter immediately.
                        message.MarkAsDeadLettered($"Event type {message.Type} not found");
                        await dbContext.SaveChangesAsync(cancellationToken);
                        PlanoraMetrics.OutboxMessagesProcessed.Add(1,
                            new KeyValuePair<string, object?>("outcome", "type_not_found"));
                        continue;
                    }

                    var @event = JsonSerializer.Deserialize(message.Content, eventType);
                    if (@event == null)
                    {
                        _logger.LogError("Failed to deserialize event {Type}", message.Type);
                        // Non-recoverable: the stored Content shape does not match the
                        // current Type contract. Retry will fail identically.
                        message.MarkAsDeadLettered($"Deserialization failed for {message.Type}");
                        await dbContext.SaveChangesAsync(cancellationToken);
                        PlanoraMetrics.OutboxMessagesProcessed.Add(1,
                            new KeyValuePair<string, object?>("outcome", "deserialize_failed"));
                        continue;
                    }

                    var publishMethod = typeof(IEventBus)
                        .GetMethod(nameof(IEventBus.PublishAsync))!
                        .MakeGenericMethod(eventType);

                    await (Task)publishMethod.Invoke(eventBus, new[] { @event, cancellationToken })!;

                    message.MarkAsProcessed();
                    await dbContext.SaveChangesAsync(cancellationToken);

                    PlanoraMetrics.OutboxMessagesProcessed.Add(1,
                        new KeyValuePair<string, object?>("outcome", "processed"));
                    _logger.LogInformation("Processed outbox message {MessageId} of type {Type}", message.Id, message.Type);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error processing outbox message {MessageId}", message.Id);

                    // MarkAsFailed owns the retry / dead-letter decision:
                    // - retries remaining -> schedules NextRetryUtc and stays Pending
                    // - retries exhausted -> auto-transitions to DeadLettered
                    // The processor no longer needs the (CanRetry ? : ) branch, which
                    // historically left exhausted messages cycling forever with a stale
                    // NextRetryUtc in the past.
                    message.MarkAsFailed(ex.Message);
                    await dbContext.SaveChangesAsync(cancellationToken);

                    var outcome = message.IsDeadLettered ? "retry_exhausted" : "failed";
                    if (message.IsDeadLettered)
                    {
                        _logger.LogError(
                            "Outbox message {MessageId} dead-lettered after {RetryCount} attempts: {Error}",
                            message.Id, message.RetryCount, message.Error);
                    }

                    PlanoraMetrics.OutboxMessagesProcessed.Add(1,
                        new KeyValuePair<string, object?>("outcome", outcome));
                }
            }

            batchStopwatch.Stop();
            PlanoraMetrics.OutboxBatchDuration.Record(batchStopwatch.Elapsed.TotalSeconds);

            return messages.Count;
        }
    }
}
