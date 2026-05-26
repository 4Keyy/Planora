# Observability

This guide is the single operational reference for Planora's observability
surface. It assumes the reader has shell access, a Grafana Cloud account
(or an alternative OTLP/Loki backend), and the deployment artifacts that
ship with the repository.

The pipeline is intentionally **safe-by-default**: with no environment
variables set, every service produces traces and metrics in-process but no
exporter is registered — there are no background connections, no log noise,
and no behaviour change. Activation is a single secret set per app.

## The Three Signals

| Signal | Producer | Default destination | How to activate the production destination |
|---|---|---|---|
| Traces | `AddPlanoraTelemetry` registers ASP.NET Core / HttpClient / EF Core / wildcard `Planora.*` `ActivitySource` instrumentation. The frontend axios interceptor emits a W3C `traceparent` on every outbound request. | None (recorded in-process only). | Set `OTEL_EXPORTER_OTLP_ENDPOINT` on every Fly app. |
| Metrics | Same extension wires ASP.NET Core / HttpClient / Runtime instrumentation plus the `PlanoraMetrics` wildcard meter (`Planora.BuildingBlocks`). | None. | Same secret as traces — OTLP carries both. |
| Logs | Serilog with correlation / span / operation / service-name enrichers writes to console + per-day rolling files. | Local disk + console. | Set `LOKI_URL` (plus `LOKI_USER` and `LOKI_TOKEN` for Grafana Cloud) on every Fly app. |

## End-to-end Trace Path

```text
Next.js page event
  └─ axios interceptor adds  traceparent: 00-<trace-id>-<span-id>-01
       └─ Ocelot Gateway       (AspNetCore instrumentation extracts the context)
            └─ Service handler  (HttpClient / EF Core spans roll up to the request)
                 └─ gRPC client (HttpClientInstrumentation captures HTTP/2 hop)
                      └─ Downstream service (extracts traceparent from metadata)
                           └─ EF Core span (CommandText captured when allowed)
```

Frontend wiring lives in `frontend/src/lib/trace.ts` (W3C trace context
generator, no SDK) and is injected by the axios request interceptor in
`frontend/src/lib/api.ts`.

Backend wiring lives in
`BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Logging/TelemetryConfiguration.cs`
and is called by every service `Program.cs` once via
`builder.Services.AddPlanoraTelemetry(builder.Configuration, "<ServiceName>")`.

## Built-in Custom Metrics

Published through one shared meter — `Planora.BuildingBlocks` —
auto-subscribed by `AddPlanoraTelemetry`:

| Instrument | Kind | Unit | Tag values |
|---|---|---|---|
| `planora.csrf.rejections` | Counter | `{rejection}` | `reason ∈ {missing_header, missing_cookie, mismatch}` |
| `planora.grpc.unauthenticated` | Counter | `{rejection}` | `reason ∈ {missing_key, short_key, mismatch}` |
| `planora.outbox.messages` | Counter | `{message}` | `outcome ∈ {processed, failed, type_not_found, deserialize_failed, retry_exhausted}`. The four non-`processed` outcomes are also the dead-letter signal — `type_not_found` and `deserialize_failed` are immediate dead-letter (no retry budget consumed); `retry_exhausted` is the transient-failure path that ran out of attempts (RetryCount = 3). `failed` is a still-recoverable transient failure with retries remaining. |
| `planora.outbox.batch.duration` | Histogram | `s` | (none) |
| `planora.outbox.message.age` | Histogram | `s` | (none) — the backpressure signal |
| `planora.avatar.uploads` | Counter | `{upload}` | `outcome ∈ {success, rejected_size, rejected_mime, rejected_content, not_authenticated, user_missing}`. Use the four `rejected_*` outcomes for "is an attacker probing the upload endpoint?" alerting (`rejected_mime` spikes = polyglot attempts; `rejected_size` spikes = DoS attempts). |
| `planora.avatar.variant.bytes` | Histogram | `By` | `size ∈ {small, medium, large}` — the WebP variant emitted by `ImageSharpImageProcessor`. Use p95 to catch encoder regressions or unexpectedly large variants. |

The cardinality budget is bounded by design: every tag value is from a
finite enumeration. No user-ids, IP addresses, or raw error strings ever
become metric labels. This is locked in by [`INVARIANTS.md`](INVARIANTS.md)
`INV-OBS-6`.

## Activating Traces and Metrics (Grafana Cloud OTLP)

Grafana Cloud's OTLP gateway accepts traces, metrics, and logs over one
endpoint with HTTP basic auth. Get the values from
**Stack → Connections → OTLP** in the Grafana Cloud dashboard.

```powershell
# Per-app, repeat for every Planora Fly app:
flyctl secrets set `
  OTEL_EXPORTER_OTLP_ENDPOINT="https://otlp-gateway-prod-eu-west-0.grafana.net/otlp" `
  OTEL_EXPORTER_OTLP_HEADERS="Authorization=Basic $base64TenantToken" `
  --app planora-<name>
```

…where `$base64TenantToken = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("$instanceId:$apiToken"))`.
The Grafana Cloud setup page provides the literal value if you prefer to
copy it.

When `OTEL_EXPORTER_OTLP_ENDPOINT` is absent, the pipeline silently runs
without an exporter — there is no fallback, no half-broken state.

## Activating Centralized Logs (Grafana Cloud Loki)

`SerilogConfiguration.TryAddLokiSink` is wired into both the
WebApplicationBuilder and IHostBuilder configuration paths. It activates
the Grafana Loki sink when a push URL is set; until then no sink is
registered.

```powershell
flyctl secrets set `
  LOKI_URL="https://logs-prod-eu-west-0.grafana.net/loki/api/v1/push" `
  LOKI_USER="<your-tenant-id>" `
  LOKI_TOKEN="<your-grafana-cloud-api-token>" `
  --app planora-<name>
```

Emitted labels: `service_name`, `environment`. Per-request labels are
deliberately absent so a per-stream-billed backend is not blindsided by
high cardinality.

Configuration keys (also read from `appsettings*.json`):

| Key | Env-var fallback | Purpose |
|---|---|---|
| `Serilog:Loki:Url` | `LOKI_URL` | push endpoint |
| `Serilog:Loki:Credentials:Login` | `LOKI_USER` | basic-auth user (Grafana Cloud tenant id) |
| `Serilog:Loki:Credentials:Password` | `LOKI_TOKEN` | basic-auth password (instance API token) |
| `Serilog:Loki:MinimumLevel` | — | default `Information` |

## Querying — Recommended Starter Dashboards

After Grafana Cloud is wired, the three dashboards below cover most
production triage. They use the labels emitted by the pipeline above and
no service-specific knowledge.

### Gateway RED (Rate / Errors / Duration)

```promql
# Request rate by service (RPS, 1m)
sum(rate(http_server_request_duration_seconds_count{service_namespace="planora"}[1m])) by (service_name)

# Error rate by service
sum(rate(http_server_request_duration_seconds_count{service_namespace="planora",http_response_status_code=~"5.."}[5m])) by (service_name)

# p95 request latency by service
histogram_quantile(0.95, sum(rate(http_server_request_duration_seconds_bucket{service_namespace="planora"}[5m])) by (service_name, le))
```

### Security signals (the noise that should be near-zero)

```promql
# CSRF rejection rate (anomalous > 0 = misconfigured frontend or active probe)
sum(rate(planora_csrf_rejections_total{}[5m])) by (reason)

# gRPC service-key rejection rate (mismatch != 0 == credential drift)
sum(rate(planora_grpc_unauthenticated_total{}[5m])) by (reason)
```

### Outbox health

```promql
# Pending message age — p95 lag seconds (rising == producers outrun processor)
histogram_quantile(0.95, sum(rate(planora_outbox_message_age_seconds_bucket[5m])) by (le))

# Terminal outcomes — share of retry-exhausted
sum(rate(planora_outbox_messages_total[5m])) by (outcome)
```

## Suggested Alerts

Cardinality and noise considerations are documented inline with each
expression; tune the thresholds against your traffic shape after the first
week of production data.

```yaml
- alert: PlanoraGrpcCredentialDrift
  expr: |
    sum(rate(planora_grpc_unauthenticated_total{reason="mismatch"}[5m])) > 0
  for: 2m
  labels:
    severity: critical
  annotations:
    summary: gRPC service-key mismatch — possible credential drift after rotation

- alert: PlanoraOutboxBackpressure
  expr: |
    histogram_quantile(0.95, sum(rate(planora_outbox_message_age_seconds_bucket[5m])) by (le)) > 60
  for: 10m
  labels:
    severity: warning
  annotations:
    summary: Outbox p95 message age > 60s — producers outrun processor

- alert: PlanoraOutboxPoison
  expr: |
    increase(planora_outbox_messages_total{outcome=~"retry_exhausted|type_not_found|deserialize_failed"}[15m]) > 0
  for: 1m
  labels:
    severity: warning
  annotations:
    summary: |
      At least one outbox message reached the terminal DeadLettered state.
      `retry_exhausted` = transient failure ran out of retries; the underlying
      cause needs a fix, after which operators replay by updating the row
      back to Pending. `type_not_found` / `deserialize_failed` = shape error
      that will fail identically on replay — requires either a schema fix or
      the row to be purged.

- alert: PlanoraCsrfAttackPattern
  expr: |
    sum(rate(planora_csrf_rejections_total{reason="mismatch"}[5m])) > 10
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: Sustained CSRF token mismatch rate — investigate possible attack or stale frontend bundle

- alert: PlanoraAvatarUploadAbuse
  expr: |
    sum(rate(planora_avatar_uploads_total{outcome=~"rejected_size|rejected_mime|rejected_content"}[5m])) > 1
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: |
      Sustained avatar-upload rejections (>1/s for 5 min). `rejected_size`
      spike = burst-DoS attempt past the 5 MB cap; `rejected_mime` /
      `rejected_content` = polyglot/exploit-payload probing. Cross-check
      the rate-limit logs (avatar-upload policy is 5/hour/user) — a single
      bad actor should be capped quickly; sustained noise means either
      many compromised tokens or a misbehaving client.

- alert: PlanoraOutboxDeadLetter
  expr: |
    increase(planora_outbox_messages_total{outcome="dead_lettered"}[5m]) > 0
  for: 1m
  labels:
    severity: critical
  annotations:
    summary: |
      An outbox message terminally dead-lettered. Unlike
      `PlanoraOutboxPoison` (which fires on the four retry-related
      outcomes), this catches anything that lands in the explicit
      DeadLettered terminal state from PR-4 of the outbox state-machine
      fix (commit 4837bb4). Operator action: inspect the row, fix the
      handler, requeue via the admin endpoint (when it lands).
```

## Sensitive Data Considerations

- **PII in EF Core span attributes** — `OpenTelemetry:Tracing:CaptureDbStatementText`
  defaults to `true` so SQL text is captured. Parameter values may contain
  PII (user emails, login attempts). Restrict the trace backend's reader
  scope or set the flag to `false` if the backend is not trusted with
  that data.
- **Authorization headers in logs** — the Gateway and every service
  explicitly suppress bearer tokens from Serilog output; passwords and
  TOTP codes are scrubbed at the validator boundary. The Loki sink
  inherits this — there is no separate redaction layer for logs.
- **Probe traffic** — every `/health*` path is filtered out of request
  tracing so liveness/readiness probes do not flood the trace backend.
  Health metrics are still emitted via the standard request-count counter,
  unfiltered, because their cardinality is bounded.

## Common Operational Questions

**Q: I set OTEL_EXPORTER_OTLP_ENDPOINT and still see no traces — why?**
A: Restart the affected Fly app (`flyctl machine restart --app planora-<name>`).
The OpenTelemetry resource is built at startup, so endpoint changes
require a restart. Verify the URL via
`flyctl secrets list --app planora-<name>`. If the endpoint requires basic
auth (Grafana Cloud does), `OTEL_EXPORTER_OTLP_HEADERS` must contain a
properly base64-encoded `Authorization=Basic` value.

**Q: I see traces but no spans from EF Core.**
A: `Tracing:Enabled` is per-pipeline; check that
`OpenTelemetry:Tracing:Enabled` is not set to `false` in appsettings. The
EF Core instrumentation runs inside the tracing pipeline; killing tracing
also kills EF spans.

**Q: My logs are in Loki but missing the `service_name` label.**
A: The label is set from the `serviceName` parameter passed to
`ConfigureEnterpriseLogging(serviceName)`. Verify every `Program.cs` is
calling the extension with a non-empty, distinct service name and not
relying on an env-var default.

**Q: How do I correlate logs and traces in Grafana Cloud?**
A: Every log line carries `TraceId` and `SpanId` properties through the
Serilog enrichers in `BuildingBlocks/.../Logging`. In Grafana Cloud, the
"Trace to logs" data-link picks them up automatically when both data
sources point at the same instance. No code change required.

## Code References

| Subject | Files |
|---|---|
| Centralized OTel wiring | `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Logging/TelemetryConfiguration.cs` |
| Custom metrics meter | `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Observability/PlanoraMetrics.cs` |
| Loki Serilog sink | `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Logging/SerilogConfiguration.cs` (`TryAddLokiSink`) |
| Serilog enrichers (correlation / span / operation / user / service / event) | `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Logging/Enrichers/` |
| CSRF metric publisher | `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Middleware/CsrfProtectionMiddleware.cs` |
| gRPC auth metric publisher | `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Grpc/ServiceKeyServerInterceptor.cs` |
| Outbox metrics publisher | `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Outbox/OutboxProcessor.cs` |
| Frontend W3C traceparent generator | `frontend/src/lib/trace.ts` |
| Frontend OTel propagation | `frontend/src/lib/api.ts` (request interceptor) |
| Configuration catalogue | [`configuration.md`](configuration.md) "OpenTelemetry (Observability)" + "Centralized Logs (Loki)" |
| Invariants | [`INVARIANTS.md`](INVARIANTS.md) `INV-OBS-1` through `INV-OBS-6` |
