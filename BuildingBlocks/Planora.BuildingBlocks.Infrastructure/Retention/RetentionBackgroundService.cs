using System.Diagnostics;
using Planora.BuildingBlocks.Infrastructure.Observability;

namespace Planora.BuildingBlocks.Infrastructure.Retention
{
    /// <summary>
    /// Daily scheduler that runs every registered <see cref="IRetentionPolicy"/> once per day at the
    /// configured off-peak UTC hour. Follows the <c>OutboxProcessor</c> shape (a <see cref="BackgroundService"/>
    /// that opens a fresh DI scope per unit of work) but on a once-a-day cadence rather than a 5-second poll.
    /// Every delete is idempotent, so a rare double-run (e.g. across a restart) is harmless; the advisory
    /// lock inside each policy prevents two replicas purging concurrently.
    /// </summary>
    public sealed class RetentionBackgroundService : BackgroundService
    {
        private readonly IServiceProvider _serviceProvider;
        private readonly IEnumerable<IRetentionPolicy> _policies;
        private readonly RetentionOptions _options;
        private readonly ILogger<RetentionBackgroundService> _logger;

        public RetentionBackgroundService(
            IServiceProvider serviceProvider,
            IEnumerable<IRetentionPolicy> policies,
            IOptions<RetentionOptions> options,
            ILogger<RetentionBackgroundService> logger)
        {
            _serviceProvider = serviceProvider;
            _policies = policies;
            _options = options.Value;
            _logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            if (!_options.Enabled)
            {
                _logger.LogInformation("Retention subsystem disabled (Retention:Enabled=false) — scheduler idle");
                return;
            }

            _logger.LogInformation(
                "Retention scheduler started — daily at {Hour:00}:00 UTC, dry-run={DryRun}, {PolicyCount} policy(ies) registered",
                _options.RunAtHourUtc, _options.DryRun, _policies.Count());

            while (!stoppingToken.IsCancellationRequested)
            {
                var delay = ComputeDelayToNextRun(DateTime.UtcNow, _options.RunAtHourUtc);
                try
                {
                    await Task.Delay(delay, stoppingToken);
                }
                catch (OperationCanceledException)
                {
                    break;
                }

                await RunAllPoliciesAsync(stoppingToken);
            }

            _logger.LogInformation("Retention scheduler stopped");
        }

        private async Task RunAllPoliciesAsync(CancellationToken cancellationToken)
        {
            foreach (var policy in _policies)
            {
                if (cancellationToken.IsCancellationRequested)
                    return;

                if (!policy.IsEnabled(_options))
                {
                    _logger.LogDebug("Retention[{Policy}] disabled by configuration — skipping", policy.Name);
                    continue;
                }

                using var scope = _serviceProvider.CreateScope();
                var stopwatch = Stopwatch.StartNew();
                try
                {
                    var context = new RetentionContext(_options, DateTime.UtcNow);
                    var result = await policy.ExecuteAsync(scope.ServiceProvider, context, cancellationToken);

                    if (!result.Skipped)
                    {
                        _logger.LogInformation(
                            "Retention[{Policy}] pass complete — scanned={Scanned}, deleted={Deleted}, dryRun={DryRun}, tripped={Tripped}",
                            result.PolicyName, result.Scanned, result.Deleted, result.DryRun, result.TrippedGuard);
                    }
                }
                catch (Exception ex)
                {
                    // One failing policy must never abort the whole pass — mirror OutboxProcessor's
                    // per-unit isolation so the remaining vectors still get cleaned.
                    _logger.LogError(ex, "Retention[{Policy}] threw — continuing with remaining policies", policy.Name);
                }
                finally
                {
                    stopwatch.Stop();
                    PlanoraMetrics.RetentionRunDuration.Record(
                        stopwatch.Elapsed.TotalSeconds,
                        new KeyValuePair<string, object?>("policy", policy.Name));
                }
            }
        }

        /// <summary>
        /// Delay from <paramref name="utcNow"/> until the next occurrence of <paramref name="runAtHourUtc"/>.
        /// Pure and static so the scheduling maths is unit-testable without a clock abstraction.
        /// </summary>
        internal static TimeSpan ComputeDelayToNextRun(DateTime utcNow, int runAtHourUtc)
        {
            var hour = Math.Clamp(runAtHourUtc, 0, 23);
            var todayRun = new DateTime(utcNow.Year, utcNow.Month, utcNow.Day, hour, 0, 0, DateTimeKind.Utc);
            var nextRun = utcNow < todayRun ? todayRun : todayRun.AddDays(1);
            return nextRun - utcNow;
        }
    }
}
