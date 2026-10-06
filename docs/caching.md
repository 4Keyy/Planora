# Caching Strategy

This reference records the caches that are actually wired in Planora. PostgreSQL remains the
source of truth; a registered cache abstraction does not imply that every query uses it.
For deployment variables, see [configuration.md](configuration.md).

## Cache Layers

| Layer | Implementation | Scope and behavior |
|---|---|---|
| Shared application cache | `ICacheService` → `CacheService` | Optional L1 `IMemoryCache` followed by L2 `IDistributedCache`/Redis; JSON serialization. Registered in BuildingBlocks; no domain query currently calls this abstraction. |
| Todo friend-id cache | `CachingFriendshipService` | Process-local list cache, 30 seconds; used by share validation, feed queries and audience resolution. `AreFriendsAsync` always calls Auth. |
| Collaboration profile cache | `CachingUserService` | Process-local name/avatar cache, 60 seconds; fetches missing profiles in one Auth gRPC batch and only caches positive results. |
| Security stamps | `SecurityStampService` and `SecurityStampValidator` | Raw Redis keys used for access-token revocation; 120-minute TTL, outside `CacheService`. |
| Token blacklist | `TokenBlacklistService` | `IDistributedCache` entry expires at the supplied token expiry; the read catches errors and returns false. |
| Data Protection keys | Auth `PersistKeysToStackExchangeRedis` | Persistent encryption key ring; not an entity cache and not covered by application invalidation. |
| Rate-limit counters | Configured Redis rate limiter | Counter state; see [auth-security.md](auth-security.md). |
| Browser assets | Next.js / Auth avatar static files | Framework-managed asset caching; avatar URLs are content-addressed and immutable. |

`CategoryGrpcClient` does **not** cache category metadata. Todo category enrichment performs
live gRPC calls scoped to the category owner. `ICacheService` has `GetAsync`, `SetAsync`,
`RemoveAsync` and `RemoveByPatternAsync`; there is no `GetOrCreateAsync` method.

## Naming Convention

`CacheKeyBuilder.Build` joins caller-provided segments with `:`. It does not add a service
namespace. `ForEntity<T>(id)` produces `EntityTypeName:<guid>`; `ForEntityList<T>(filters)`
produces `EntityTypeName:list:<filters>`; `PatternForEntity<T>()` produces `EntityTypeName:*`.
The shared Redis distributed-cache provider prepends the instance name `planora_` to physical
Redis keys. For example, a logical `Category:<guid>` becomes `planora_Category:<guid>`.

Concrete caches have separate naming rules:

| State | Key | Expiration |
|---|---|---|
| Todo accepted friend IDs | `todo:friend-ids:<guid in N format>` in memory | 30 seconds absolute |
| Collaboration profile | `collaboration:user-profile:<guid in N format>` in memory | 60 seconds absolute |
| Security stamp | `security:stamp:<guid>` in raw Redis | 120 minutes |
| Token blacklist | `token:blacklist:<token>` logical distributed-cache key | Remaining token lifetime |
| Auth Data Protection | `Planora:Auth:DataProtection-Keys` in raw Redis | Key-ring lifecycle |

Redis access can contain sensitive token/key-ring material. Inspect key names and TTLs only
when diagnosing a specific issue; do not dump values into logs or documentation.

## Shared Cache TTL And Failure Behavior

`CacheOptions` defaults are `DefaultExpiration = 30 minutes`, `ShortExpiration = 5 minutes`,
`LongExpiration = 2 hours`, `UseLocalCache = true`, `LocalCacheSize = 1000`, and
`EnableCompression = true`. The latter two options are currently not consumed by
`CacheService`: JSON is not compressed, and the shared memory cache is configured separately
in BuildingBlocks DI with `SizeLimit = 104857600`. This is an entry-size budget, not a
measurement of bytes; these cache entries declare `Size = 1`.

`SetAsync` uses the caller's TTL, or `DefaultExpiration` when omitted. L1 expires after the
smaller of that TTL and five minutes. A Redis hit uses the remaining Redis key TTL when the
raw multiplexer is available; otherwise L1 falls back to five minutes. The cache catches
read/write/remove errors: reads return the default value, while writes/removes log and return.
Callers must treat a cache miss as a reason to consult the source of truth.

## Invalidation Rules

The shared `CacheInvalidator` delegates explicit key removal and entity-prefix removal to
`CacheService`. No service handler or integration-event consumer currently calls it;
there is no automatic integration-event invalidation pipeline for the two concrete local
caches. Their consistency bound is their absolute TTL.

`RemoveAsync` removes the distributed key and the current process's L1 entry.
`RemoveByPatternAsync` cancels the current process's prefix token, scans primary Redis
endpoints with the `planora_` prefix, and deletes matched keys in batches of 500. It skips
Redis scanning with a warning if no raw multiplexer is registered. It does not broadcast
L1 eviction to other replicas. Do not assume distributed removal immediately evicts an
entry already cached in another process.

## Authorization And Freshness

- Live `AreFriendsAsync` checks gate normal non-owner task detail, completion and branch
  access. The 30-second friend-ID list is also used by feed selection and share validation;
  a friendship change can therefore take up to that TTL to affect those list-based paths.
  Friendship-removal events independently remove stale explicit shares; they do not remove
  worker rows in that consumer. The public join path and subtask-creator mutation path have
  documented authorization exceptions in [auth-security.md](auth-security.md). A cache is
  not a replacement for the live authorization check.
- Collaboration profile staleness is bounded at 60 seconds. Missing users and failures are
  not negatively cached, so a recovered Auth service can provide names/avatars on the next read.
- Todo items, task lists, categories, comments, messages and notification read models are
  read from their owning services; the generic entity-cache registration does not cache them.
- Access tokens live in frontend memory. The auth store's persistence policy and security
  stamp failure behavior are documented in [auth-security.md](auth-security.md).

## Observability

`CacheService.GetAsync` records `planora.cache.operations` with `prefix` and `outcome`:
`hit_l1`, `hit_l2`, `miss`, or `error`. `prefix` is the first colon-delimited key segment;
an empty segment or one longer than 48 characters becomes `_other_`.
These metrics cover the generic shared cache only, not the friend-ID/profile decorators,
security-stamp checks or rate limiter. A registered meter with no domain call sites can
correctly produce no samples.

The two local decorators emit debug logs on misses. Redis health is included when an
explicit Redis connection is configured; see [observability.md](observability.md) and
[architecture.md](architecture.md#health-probe-architecture).

## References

- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Caching/`
- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/DependencyInjection.cs`
- `Services/TodoApi/Planora.Todo.Infrastructure/Services/CachingFriendshipService.cs`
- `Services/TodoApi/Planora.Todo.Infrastructure/Grpc/CategoryGrpcClient.cs`
- `Services/CollaborationApi/Planora.Collaboration.Infrastructure/Grpc/CachingUserService.cs`
- `Services/AuthApi/Planora.Auth.Infrastructure/Services/Security/`
- [Architectural invariants](INVARIANTS.md)
