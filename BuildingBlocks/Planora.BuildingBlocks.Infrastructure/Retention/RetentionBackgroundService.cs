using System.Diagnostics;
using Planora.BuildingBlocks.Infrastructure.Observability;

namespace Planora.BuildingBlocks.Infrastructure.Retention
{
    /// <summary>
    /// Scheduler that runs every registered <see cref="IRetentionPolicy"/> every
    /// <see cref="RetentionOptions.RunEveryHours"/> hours (hourly by default; 24 for a single daily pass at
    /// <see cref="RetentionOptions.RunAtHourUtc"/>), plus a catch-up pass shortly after startup. Follows the
    /// <c>OutboxProcessor</c> shape (a <see cref="BackgroundService"/> that opens a fresh DI scope per unit of
    /// work) on an hourly cadence rather than a 5-second poll. Every delete is idempotent, so a rare
    /// double-run (e.g. across a restart) is harmless; the advisory lock inside each policy prevents two
    /// replicas purging concurrently.
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
                "Retention scheduler started — every {EveryHours}h from {Hour:00}:00 UTC, dry-run={DryRun}, runOnStartup={RunOnStartup}, {PolicyCount} policy(ies) registered",
                Math.Clamp(_options.RunEveryHours, 1, 24), _options.RunAtHourUtc, _options.DryRun, _options.RunOnStartup, _policies.Count());

            // Startup catch-up pass: on every launch, purge data that is already past its window instead of
            // waiting for the next RunAtHourUtc. A short delay first lets the database and broker come up so
            // the pass does not race the app's own startup. Deletes are idempotent and guarded by the
            // advisory lock, so a restart-heavy environment simply finds less to do each time.
            if (_options.RunOnStartup)
            {
                try
                {
                    await Task.Delay(TimeSpan.FromSeconds(Math.Max(0, _options.StartupDelaySeconds)), stoppingToken);
                }
                catch (OperationCanceledException)
                {
                    return;
                }

                _logger.LogInformation("Retention running startup catch-up pass");
                await RunAllPoliciesAsync(stoppingToken);
            }

            while (!stoppingToken.IsCancellationRequested)
            {
                var delay = ComputeDelayToNextRun(DateTime.UtcNow, _options.RunAtHourUtc, _options.RunEveryHours);
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
        /// Delay from <paramref name="utcNow"/> until the next pass: the first slot strictly after now on the
        /// continuous UTC grid anchored at the Unix epoch's <paramref name="runAtHourUtc"/> and stepping every
        /// <paramref name="everyHours"/> (clamped to 1–24). With 24 that is "the next <paramref name="runAtHourUtc"/>".
        /// Pure and static so the scheduling maths is unit-testable without a clock abstraction.
        /// </summary>
        internal static TimeSpan ComputeDelayToNextRun(DateTime utcNow, int runAtHourUtc, int everyHours = 24)
        {
            var hour = Math.Clamp(runAtHourUtc, 0, 23);
            var step = TimeSpan.FromHours(Math.Clamp(everyHours, 1, 24));
            // A daily anchor shortens intervals that do not divide 24 at midnight (e.g. 7h becomes 3h).
            // An epoch anchor keeps the same grid across dates and across service replicas/restarts.
            var anchor = DateTime.UnixEpoch.AddHours(hour);
            var ticksSinceSlot = (utcNow - anchor).Ticks % step.Ticks;
            if (ticksSinceSlot < 0)
                ticksSinceSlot += step.Ticks;

            return TimeSpan.FromTicks(step.Ticks - ticksSinceSlot);
        }
    }
}
