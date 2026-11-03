# READ-014 source review

Reviewed all 25 BuildingBlocks files in full at HEAD `f12f038e7b545456f82cb6e256592a3c8544d355` (2026-11-03, Europe/Moscow). Exact ranges, line counts, SHA256 and semantic caller/trust/state/error/concurrency/test notes are in [JSON evidence](read-014-review.json).

Status: **REVIEWED_SOURCE_ONLY**. This review ran no application tests, builds or live infrastructure operations. It does not certify the root's separate T05/broader gates.

## BE-010 (source-review reference CONT014001, P2)

`RetentionOptions.MaxDeletionsPerRun` is described as a per-pass safety cap, but `RetentionExecutor.RunAsync` checks it only against the initial eligible count. Its batch loop then drains current matches and accumulates `total` without checking remaining budget. Domain writers can make additional rows qualify while the pass is in progress; the advisory lock excludes peer retention passes, not those writes. A pass can therefore delete more than its configured cap and report `Deleted > Scanned`.

Evidence: `RetentionOptions.cs:53-60`, supplemental `RetentionExecutor.cs:41-62,72-88`, `SoftDeletedPurgePolicy.cs:43-55`, `ProcessedMessagePurgePolicy.cs:46-57,66-77`. Exact full paths are recorded in JSON. No production incident or provider reproduction is claimed.

Reachability limit: no normal application path that adds past-cutoff rows during this same pass was demonstrated. Most reviewed policies use a fixed cutoff and assign current timestamps to newly-completed/deleted rows; those rows do not automatically qualify. Backfill/restore or another concurrent transition must be reproduced before claiming normal-runtime impact.

T13/retention owner should first add a deterministic regression with cap 10, initial count 10 and delete results 10, 1, 0, then verify a separate-writer provider case. Define and enforce the per-pass deletion budget while retaining dry-run, advisory release and cancellation. These regressions were not executed in this source review.

## Other conclusions and limits

- `BaseRepository.GetPagedAsync` is another unchecked-offset surface of existing **BE-008**, not a new finding.
- Production activation of `IdempotencyMiddleware` was not found in the searched Services/BuildingBlocks/Gateway/frontend tree. Its optional Redis/key/TTL limitations must not be presented as active endpoint failures or platform-wide idempotency support.
- Legacy root-namespace logging enrichers differ from the active `Logging.Enrichers` implementations; the no-op legacy UserId enricher does not prove broken enterprise enrichment.
- Shared current-user claims extraction is not covered by the inspected sibling Auth/Category implementation tests. Metrics, tracing and header definitions do not prove live delivery, PII absence, browser security or production configuration.
- Retention defaults actively purge data after startup. Only source was inspected; no working stack or data was touched.
- Source/index/findings/PROGRESS were not modified. Root owns final finding ID, current index integration and later executable verification.

## Exact coverage

| File | Full range |
| --- | --- |
| `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Logging/OperationEnricher.cs` | 1-21 |
| `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Logging/SerilogConfiguration.cs` | 1-223 |
| `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Logging/SpanIdContext.cs` | 1-38 |
| `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Logging/SpanIdEnricher.cs` | 1-22 |
| `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Logging/TelemetryConfiguration.cs` | 1-150 |
| `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Logging/UserIdEnricher.cs` | 1-31 |
| `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Messaging/DomainEventDispatcher.cs` | 1-102 |
| `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Messaging/IRabbitMqConnectionManager.cs` | 1-7 |
| `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Middleware/CorrelationIdMiddleware.cs` | 1-72 |
| `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Middleware/EnhancedGlobalExceptionMiddleware.cs` | 1-430 |
| `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Middleware/IdempotencyMiddleware.cs` | 1-208 |
| `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Middleware/SecurityHeadersMiddleware.cs` | 1-51 |
| `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Observability/PlanoraMetrics.cs` | 1-142 |
| `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Outbox/OutboxSignal.cs` | 1-48 |
| `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Persistence/BaseRepository.cs` | 1-179 |
| `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Persistence/CurrentUserService.cs` | 1-40 |
| `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Persistence/N1Sentinel.cs` | 1-257 |
| `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Planora.BuildingBlocks.Infrastructure.csproj` | 1-68 |
| `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Resilience/DependencyWaiter.cs` | 1-166 |
| `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Retention/IRetentionLock.cs` | 1-23 |
| `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Retention/IRetentionPolicy.cs` | 1-57 |
| `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Retention/Policies/ProcessedMessagePurgePolicy.cs` | 1-94 |
| `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Retention/Policies/SoftDeletedPurgePolicy.cs` | 1-58 |
| `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Retention/RetentionOptions.cs` | 1-141 |
| `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Retention/RetentionServiceCollectionExtensions.cs` | 1-29 |

Total source lines read: **2657**. Supplemental symbols/tests do not expand the 25-file batch coverage.

Root assigned `BE-010` in the canonical findings register; the provisional ID remains in the original source-review data for provenance.
