using System.Diagnostics.Metrics;

namespace Planora.BuildingBlocks.Infrastructure.Observability;

/// <summary>
/// Shared <see cref="Meter"/> for every Planora service. Exposed instruments are picked up
/// automatically by the wildcard meter subscription in <c>TelemetryConfiguration.AddPlanoraTelemetry</c>
/// (the meter name matches <c>Planora.*</c>).
/// </summary>
/// <remarks>
/// Naming follows OpenTelemetry semantic conventions:
/// <list type="bullet">
/// <item><description>units are explicit (e.g. <c>{rejections}</c>, <c>s</c>, <c>1</c>);</description></item>
/// <item><description>cumulative counters use the <c>_total</c> implicit suffix added by the
/// Prometheus exporter — the .NET counter name itself omits it;</description></item>
/// <item><description>dimensions are low cardinality (a small finite set of <c>reason</c>/<c>outcome</c>
/// tags) so the metrics back-end does not explode into thousands of series.</description></item>
/// </list>
/// </remarks>
public static class PlanoraMetrics
{
    public const string MeterName = "Planora.BuildingBlocks";
    public const string MeterVersion = "1.0.0";

    public static readonly Meter Meter = new(MeterName, MeterVersion);

    /// <summary>
    /// Counter incremented every time the CSRF middleware rejects a request.
    /// Tag <c>reason</c> ∈ {<c>missing_header</c>, <c>missing_cookie</c>, <c>mismatch</c>}.
    /// </summary>
    public static readonly Counter<long> CsrfRejections = Meter.CreateCounter<long>(
        name: "planora.csrf.rejections",
        unit: "{rejection}",
        description: "Number of state-changing requests rejected by the CSRF double-submit validator.");

    /// <summary>
    /// Counter incremented every time the gRPC service-key interceptor rejects an inbound RPC.
    /// Tag <c>reason</c> ∈ {<c>missing_key</c>, <c>short_key</c>, <c>mismatch</c>}.
    /// </summary>
    public static readonly Counter<long> GrpcUnauthenticated = Meter.CreateCounter<long>(
        name: "planora.grpc.unauthenticated",
        unit: "{rejection}",
        description: "Number of inbound gRPC calls rejected by the service-key interceptor.");

    /// <summary>
    /// Counter incremented per outbox message processed. Tag <c>outcome</c> ∈
    /// {<c>processed</c>, <c>failed</c>, <c>type_not_found</c>, <c>deserialize_failed</c>,
    /// <c>retry_exhausted</c>}.
    /// </summary>
    public static readonly Counter<long> OutboxMessagesProcessed = Meter.CreateCounter<long>(
        name: "planora.outbox.messages",
        unit: "{message}",
        description: "Number of outbox messages traversed by the processor, partitioned by terminal outcome.");

    /// <summary>
    /// Histogram of per-batch processing duration in seconds.
    /// </summary>
    public static readonly Histogram<double> OutboxBatchDuration = Meter.CreateHistogram<double>(
        name: "planora.outbox.batch.duration",
        unit: "s",
        description: "Wall-clock duration of one outbox processing pass.");

    /// <summary>
    /// Histogram of per-message lag in seconds (<c>now - occurredOnUtc</c> at the moment the
    /// processor picks the message up). Detects backpressure: rising p95 means the producer
    /// is outrunning the processor.
    /// </summary>
    public static readonly Histogram<double> OutboxMessageAge = Meter.CreateHistogram<double>(
        name: "planora.outbox.message.age",
        unit: "s",
        description: "Lag between when an outbox message was produced and when the processor picked it up.");

    /// <summary>
    /// Counter incremented every time the avatar upload pipeline accepts or rejects a file.
    /// Tag <c>outcome</c> ∈ {<c>success</c>, <c>rejected_size</c>, <c>rejected_mime</c>,
    /// <c>rejected_content</c>, <c>not_authenticated</c>, <c>user_missing</c>}.
    /// Low cardinality (six values) so safe to keep on a Prometheus/Loki label.
    /// </summary>
    public static readonly Counter<long> AvatarUploads = Meter.CreateCounter<long>(
        name: "planora.avatar.uploads",
        unit: "{upload}",
        description: "Number of avatar upload attempts, partitioned by outcome.");

    /// <summary>
    /// Histogram of WebP variant byte size emitted by the avatar pipeline. Tag <c>size</c>
    /// ∈ {<c>small</c>, <c>medium</c>, <c>large</c>}. Helps detect ImageSharp encoder
    /// regressions or unusually large variants.
    /// </summary>
    public static readonly Histogram<long> AvatarVariantBytes = Meter.CreateHistogram<long>(
        name: "planora.avatar.variant.bytes",
        unit: "By",
        description: "Re-encoded WebP variant size in bytes, per variant tier.");

    /// <summary>
    /// Counter incremented on every cache <c>GetAsync</c> call. Tags:
    /// <c>prefix</c> — first colon-delimited segment of the cache key
    /// (entity name when callers use <c>CacheKeyBuilder.ForEntity</c>);
    /// <c>outcome</c> ∈ {<c>hit_l1</c>, <c>hit_l2</c>, <c>miss</c>, <c>error</c>}.
    /// Hit ratio is derived in the metrics back-end:
    /// <c>sum(rate(planora_cache_operations_total{outcome=~"hit_.*"}[5m])) /
    /// sum(rate(planora_cache_operations_total[5m])) by (prefix)</c>.
    /// Cardinality is bounded by the set of entity prefixes the codebase emits
    /// (low double-digits); a cap is enforced in <c>CacheService</c> to defend
    /// against an unbounded callsite leaking arbitrary segments.
    /// </summary>
    public static readonly Counter<long> CacheOperations = Meter.CreateCounter<long>(
        name: "planora.cache.operations",
        unit: "{operation}",
        description: "Cache get operations, partitioned by key prefix and outcome (hit_l1 / hit_l2 / miss / error).");

    /// <summary>
    /// Counter of rows physically purged by the retention subsystem. Tag <c>policy</c> — the retention
    /// policy name (low cardinality: one per registered vector, e.g. <c>outbox-inbox-purge</c>,
    /// <c>soft-delete-purge:TodoItem</c>). Zero in dry-run mode.
    /// </summary>
    public static readonly Counter<long> RetentionRowsDeleted = Meter.CreateCounter<long>(
        name: "planora.retention.rows_deleted",
        unit: "{row}",
        description: "Rows physically deleted by a retention policy pass, partitioned by policy.");

    /// <summary>
    /// Counter incremented when a retention policy's tripwire aborts a pass because the eligible-row count
    /// exceeded <c>MaxDeletionsPerRun</c>. A non-zero rate is an alert condition — something is mass-marking
    /// rows deletable. Tag <c>policy</c>.
    /// </summary>
    public static readonly Counter<long> RetentionTripwire = Meter.CreateCounter<long>(
        name: "planora.retention.tripwire",
        unit: "{trip}",
        description: "Number of retention passes aborted by the safety tripwire, partitioned by policy.");

    /// <summary>Counter of retention policy passes that threw. Tag <c>policy</c>.</summary>
    public static readonly Counter<long> RetentionErrors = Meter.CreateCounter<long>(
        name: "planora.retention.errors",
        unit: "{error}",
        description: "Number of retention policy passes that failed, partitioned by policy.");

    /// <summary>Histogram of per-policy pass duration in seconds. Tag <c>policy</c>.</summary>
    public static readonly Histogram<double> RetentionRunDuration = Meter.CreateHistogram<double>(
        name: "planora.retention.run.duration",
        unit: "s",
        description: "Wall-clock duration of one retention policy pass.");
}
