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
}
