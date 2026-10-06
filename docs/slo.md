# Service Level Objectives (Baseline)

This document is the **starter SLO set** for Planora. It is intentionally
small — five SLOs covering the user-visible critical path — so the team can
measure error budgets meaningfully from day one of production without
drowning in dashboards.

> Numbers in this file are **operational targets**, not contractual
> commitments. They are reviewed and refreshed at the end of each quarter
> against the metrics produced by [`docs/observability.md`](observability.md).

## How To Read This Doc

| Field | Meaning |
|---|---|
| **SLI** | The Service Level Indicator — the metric you actually measure. Concrete PromQL given so the value is reproducible. |
| **Objective** | The numeric target the SLI must satisfy over the **rolling 28-day window**. |
| **Error budget** | The allowed shortfall implied by the objective. Burning the budget is a signal that change velocity must drop in favour of reliability work. |
| **Owner** | The component whose health the SLO measures. |
| **Source** | Where the SLI samples come from. |

A rolling 28-day window contains four weekly cycles. This is the project's proposed accounting period; it is not evidence that a dashboard/rule is deployed.

## Query validation prerequisite

PromQL expressions are templates that assume the collector exposes the listed names/resource labels. Verify actual metric samples first: Ocelot may label catch-all routes instead of raw URL paths, and no production metrics backend was queried in this audit. Health trace filtering does not automatically filter probe metrics. Do not install a route-specific SLI that matches zero series.

## SLO-01 — Gateway request availability

The fraction of Gateway HTTP requests that complete without a 5xx server
error, excluding probe traffic.

| Field | Value |
|---|---|
| SLI | `1 - (sum(rate(http_server_request_duration_seconds_count{service_name="ApiGateway",http_response_status_code=~"5..", http_route!~"/health.*"}[28d])) / sum(rate(http_server_request_duration_seconds_count{service_name="ApiGateway",http_route!~"/health.*"}[28d])))` |
| Objective | **≥ 99.5%** over a rolling 28-day window |
| Error budget | 0.5% of eligible requests may fail; at uniform traffic only, this corresponds to 3 h 21 m 36 s per 28 days |
| Owner | Gateway (ingress edge) |
| Source | OpenTelemetry ASP.NET Core request metric exported from `Planora.ApiGateway` |

## SLO-02 — Authenticated read latency (p95)

The 95th-percentile end-to-end latency for the hot read path
`GET /todos/api/v1/todos`, measured at the gateway.

| Field | Value |
|---|---|
| SLI | `histogram_quantile(0.95, sum(rate(http_server_request_duration_seconds_bucket{service_name="ApiGateway",http_route=~"/todos/api/v1/todos.*",http_request_method="GET"}[5m])) by (le))` |
| Objective | **p95 ≤ 400 ms** at any time during the rolling 28-day window |
| Error budget | The threshold itself; a p95 above 400 ms for ≥ 5 minutes counts as a single budget burn. |
| Owner | Todo API + Auth gRPC + Category gRPC |
| Source | OpenTelemetry ASP.NET Core request metric (gateway side) |

The matching k6 baseline scenario `perf/k6/scenarios/todo-list.js` codifies
the same threshold against the local Docker stack — the absolute latency targets match, but a local k6 run does not implement a rolling production error budget. The default list workload has no seeded tasks/shares and can encounter gateway rate limits.

## SLO-03 — Login authentication latency (p95)

The 95th-percentile latency for the user-visible login operation
`POST /auth/api/v1/auth/login`.

| Field | Value |
|---|---|
| SLI | `histogram_quantile(0.95, sum(rate(http_server_request_duration_seconds_bucket{service_name="ApiGateway",http_route="/auth/api/v1/auth/login",http_request_method="POST"}[5m])) by (le))` |
| Objective | **p95 ≤ 800 ms** at any time during the rolling 28-day window |
| Error budget | A p95 above 800 ms for ≥ 5 minutes counts as a budget burn. |
| Owner | Auth API |
| Source | OpenTelemetry ASP.NET Core request metric (gateway side) |

The login path runs PBKDF2 (HMAC-SHA512, 210,000 iterations) password verification
(deliberately slow); the budget includes its cost.

## SLO-04 — Outbox processing freshness

The integration-event outbox must drain quickly enough that downstream
consumers see a producer's event within one minute at p95.

| Field | Value |
|---|---|
| SLI | `histogram_quantile(0.95, sum(rate(planora_outbox_message_age_seconds_bucket[5m])) by (le))` |
| Objective | **p95 ≤ 60 s** over the rolling 28-day window |
| Error budget | A p95 above 60 s for ≥ 10 minutes burns the budget. Sustained burn is the signal that the outbox processor needs to be extracted from the API process into the dedicated worker app (`deploy/fly/outbox-worker.fly.toml`). |
| Owner | `OutboxProcessor` (currently in-process; tracked for extraction) |
| Source | `PlanoraMetrics.OutboxMessageAge` histogram |

## SLO-05 — Realtime notification fan-out

Proposed target: a notification submitted through the implemented Realtime send endpoint reaches the connected target group within 5 seconds. The current code does not measure or guarantee client receipt.

| Field | Value |
|---|---|
| SLI | No fan-out latency instrument exists. Persistent notification storage is implemented conditionally, but delivery-attempt rows and reconnect replay are not active guarantees. Gateway submission latency is only a server request proxy, not delivery latency. |
| Objective | **(provisional)** p95 submission → SignalR group send ≤ 5 s once instrumented. |
| Error budget | No measurable error budget is defined until a delivery/receipt SLI is implemented. |
| Owner | Realtime API |
| Source | Proposed `planora.realtime.fanout.latency` instrument; current startup has ASP.NET/HTTP/EF/runtime instrumentation, not a dedicated client-receipt metric. |

This SLO is published as **provisional** so operators can see the gap and
the team can plan toward closing it.

## Error-budget Policy

When an SLO's error budget is **fully consumed** in the rolling 28-day
window:

1. **Feature work pauses** on the owner component until the budget recovers
   (typically the next deploy that is purely reliability-oriented).
2. The owner files a brief incident review describing the burn, the
   contributing factor, and the corrective action.
3. The SLO target is re-evaluated only if the value has been wrong for two
   consecutive windows.

When **half** the budget is consumed early in the window, the owner posts a
"yellow" notice to the team Slack/Discord; no work pauses, but new launches
that increase the load on the same path must include their own load
projection.

## Activation

These SLOs are **declared but not yet enforced**. Enforcement requires:

1. `OTEL_EXPORTER_OTLP_ENDPOINT` set on every Fly app so the metrics flow
   to a real metrics backend (see [`docs/observability.md`](observability.md)).
2. The PromQL above pinned into Grafana Cloud dashboards (named
   `planora-slo-gateway`, `planora-slo-todo`, etc.).
3. The example alert rules from [`docs/observability.md`](observability.md)
   "Suggested Alerts" hooked into your notification channel.

Until activation, treat this file as the **proposed numeric definition** of
what "good enough" looks like, so the eventual dashboards land with the
right thresholds.

## References

- [`docs/observability.md`](observability.md) — metric source pipelines and PromQL examples
- [`perf/k6/scenarios/`](../perf/k6/scenarios/) — k6 thresholds matching SLO-02 and SLO-03 at local scale
- [`docs/architecture.md`](architecture.md) "Observability Architecture"
- [`docs/INVARIANTS.md`](INVARIANTS.md) `INV-OBS-6` — Planora metric cardinality discipline
