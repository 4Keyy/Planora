# Caching Strategy

This document is the single reference for **what is cached, where, with which
TTL, and how it is invalidated**. The goal is one explicit answer for every
piece of cached state in the system, so a reviewer can spot the addition of
an undocumented cache during code review.

## Cache Layers

| Layer | Backend | Purpose | Code |
|---|---|---|---|
| Distributed application cache | Redis (StackExchange.Redis via `Microsoft.Extensions.Caching.StackExchangeRedis`) | Cross-replica, durable-during-restart cache for entity reads and derived values. | `BuildingBlocks.Infrastructure.Caching.CacheService`, `ICacheService` |
| Cache key builder | (no backend) | Centralized key naming convention so every reader and invalidator agrees on the literal Redis key. | `BuildingBlocks.Infrastructure.Caching.CacheKeyBuilder` |
| Cache invalidator | Redis | Pattern-based key deletion driven by integration events. | `BuildingBlocks.Infrastructure.Caching.CacheInvalidator`, `ICacheInvalidator` |
| ASP.NET output cache / response cache | none | Not used — `[ResponseCache]` is intentionally absent on data endpoints because their freshness budget is shorter than a sensible Cache-Control TTL. |  |
| Browser HTTP cache | per response | Static frontend assets only. Next.js handles its own `Cache-Control` headers on `_next/static/*`; API responses are not cached. |  |
| Rate-limit counter store | Redis (`RedisRateLimiting.AspNetCore`) | Per-partition fixed-window counters shared across every replica. See [`auth-security.md`](auth-security.md) "Rate Limiting". | `ServiceCollectionExtensions.AddConfiguredRateLimiting` |
| ASP.NET Data Protection key ring | Redis (`PersistKeysToStackExchangeRedis`) | Encryption keys for TOTP secrets at rest; survives container restart. | `Services/AuthApi/Planora.Auth.Infrastructure/DependencyInjection.cs` |

The "rate-limit" and "data-protection" layers are listed for completeness;
they are not application caches and are not invalidated by the same rules.

## Naming Convention

Every cache key is produced by `CacheKeyBuilder` so the literal Redis key is
not a free-form string. The convention is:

    planora:<service>:<resource>:<id-or-shape>

For example: `planora:todo:item:<guid>`, `planora:auth:friend-ids:<user>`.

This gives operators a non-overlapping Redis key namespace per service and
makes `KEYS planora:todo:*` (in a maintenance window, never in prod) a
reliable way to inspect a single service's cache footprint.

## Cached Resources Today

The list below is exhaustive at the time of writing. **Adding a new cached
resource requires adding a row here in the same commit.**

| Resource | Reader | TTL | Invalidator | Why |
|---|---|---|---|---|
| Category metadata (name/color/icon) read by Todo service | `CategoryGrpcClient.GetCategoryInfoAsync` (caches the gRPC result) | short (minutes) — gRPC client cache | `CategoryDeletedIntegrationEvent` consumer in Todo API | Todo lists render the friend's category badge; without a cache the read is one gRPC call per todo. |
| Cached helper values inside `BuildingBlocks.Infrastructure.Caching` | `CacheService.GetOrCreateAsync` callers | per-call (passed to `GetOrCreateAsync`) | per-caller via `CacheInvalidator` | Generic primitive; concrete TTLs are defined at the call site, not in the layer. |

The deliberately short list reflects Planora's current scale. Anything that
fits in a single PostgreSQL roundtrip and serves browser UI is **not**
cached, on the grounds that the optimization is premature and a stale cache
is a worse failure mode than a 30 ms query.

## TTL Convention

Use these as the default budget; a longer TTL needs justification in the
PR description and a corresponding row in the table above.

| Class of data | TTL | Rationale |
|---|---|---|
| User-owned resource that the user can mutate from the same browser session | ≤ 30 s | The user expects "create then list" to be consistent within one screen interaction. |
| Cross-service metadata that changes rarely (category color, friendship existence) | 1–5 minutes | These are read on every todo list response. The bound is set by the worst latency the user accepts for the metadata to catch up after the owner edits it. |
| Reference data with no mutation surface (enum labels, system messages) | hours | Indefinite is acceptable for truly immutable values; pin the TTL anyway so a key purge naturally heals drift. |
| Anything stored in Data Protection / rate-limit Redis | governed by their own pipeline, not this convention | Listed only because they share the Redis instance. |

## Invalidation Rules

The cache is invalidated by **integration events**, never by HTTP-side
"after save" code in handlers. Handlers write to the DB through the outbox;
the matching consumer drains the event and calls `ICacheInvalidator`. This
guarantees:

1. **At-least-once invalidation.** The integration-event delivery is durable;
   the outbox/inbox pattern survives broker outages and consumer restarts.
2. **Idempotent invalidation.** Re-delivery of an event re-runs the same
   delete; Redis `DEL` is naturally idempotent.
3. **No write-path coupling.** A handler that forgets to invalidate does not
   ship stale data forever — the invalidator runs from a separate process
   path and any change still flows through the outbox.

For caches that depend on a piece of data the producer cannot enumerate
(e.g. category color used by many todos), the invalidator uses Redis
`SCAN` with the relevant key prefix and deletes the matched keys. Avoid
`KEYS *` in any code path — it blocks the Redis main thread.

## What is NOT cached, and why

- **Todo lists themselves** — viewer-specific (hidden state, viewer category,
  worker membership). The cardinality is `users × pages × filters` which
  defeats the point of caching.
- **Auth user details** — the JWT carries the relevant claims; the only
  per-request DB hit is the security stamp validator, and that path already
  uses Redis through `ISecurityStampService`.
- **CSRF tokens** — produced fresh per request, validated by constant-time
  comparison; caching would either reduce entropy or add no value.
- **Frontend `accessToken`** — in-memory Zustand store only.
  See [`docs/auth-security.md`](auth-security.md) "Authentication Model".

## Observability

The Redis instance health is part of the readiness probe (see
[`docs/architecture.md`](architecture.md) "Health Probe Architecture").
Future work: a `planora.cache.hit_ratio` metric per cache key prefix is on
the master plan as a Phase 4 follow-up. Until then, infer hit-ratio from
gRPC call rates (a falling category-gRPC RPS at the same Todo RPS = the
cache is working).

## References

- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Caching/CacheService.cs`
- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Caching/CacheInvalidator.cs`
- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Caching/CacheKeyBuilder.cs`
- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Caching/CacheOptions.cs`
- [`docs/architecture.md`](architecture.md) — outbox/inbox pattern.
- [`docs/observability.md`](observability.md) — current metric surface.
- [`docs/INVARIANTS.md`](INVARIANTS.md) — `INV-COMM-3` and `INV-COMM-4`
  bind invalidation to the outbox/inbox.
