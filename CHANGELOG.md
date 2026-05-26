# Changelog

All notable changes to Planora are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### PR-8 rate-limit: avatar-upload policy + IPv6 normalization (2026-05-26)

**Per-endpoint policy.** The avatar upload endpoint previously inherited the generic `auth` policy (10/min/user), meaning an attacker with a valid token could upload 10× 5 MB files per minute = 50 MB/min/user disk churn even with PR-1's per-file caps in place. New `avatar-upload` policy (5/hour/user) bounds worst-case write traffic to ~30 MB/hour/user. `[EnableRateLimiting("avatar-upload")]` is now attached to `POST /users/me/avatar`.

To support windows other than 1 minute, `AddInMemoryPolicy` / `AddRedisPolicy` / `RedisOptions` now take an explicit `TimeSpan window` parameter. Existing policies keep their 1-minute windows unchanged.

**IPv6 normalization.** `PartitionKey` now collapses `IsIPv4MappedToIPv6` addresses (`::ffff:1.2.3.4`) to their IPv4 form via `IPAddress.MapToIPv4()`. Without this, a dual-stack listener gave a single client two buckets (one keyed by the v6-mapped form, one by the plain v4 form), effectively doubling their quota.

**Tests** (+2, full = 713 green): `RateLimitPartitionKeyTests` gains `PartitionKey_NormalizesIPv4MappedIPv6ToIPv4` and `PartitionKey_HandlesPureIPv6Address`. Asserts dual-stack → same bucket, pure IPv6 → `ip:2001:db8::1`.

**Docs.** `docs/auth-security.md` § "Rate Limiting" — new `avatar-upload` row and the IPv6-normalization note.

Refs: `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Extensions/ServiceCollectionExtensions.cs`, `Services/AuthApi/Planora.Auth.Api/Controllers/UsersController.cs`, `tests/Planora.UnitTests/Services/Infrastructure/RateLimitPartitionKeyTests.cs`.

### PR-6 security(stamp): close stamp-enforcement gap on Auth API (2026-05-26)

**Security gap.** `Services/AuthApi/Planora.Auth.Infrastructure/DependencyInjection.cs`'s `AddJwtAuthentication` configured `JwtBearerOptions` without any `OnTokenValidated` hook, so it never invoked `SecurityStampValidator.IsTokenRevokedAsync`. Consumer services (Category, Todo via `AddJwtAuthenticationForConsumer`; Messaging, Realtime inline) all did this check — but Auth itself did not.

That meant after a password change, 2FA disable, revoke-all-sessions, account delete, or email change, every other service correctly rejected the user's old access token, but Auth's own surface (e.g. `/me`, `/me/sessions`, `/me/login-history`, even `/me/change-password`) kept accepting it until natural expiry. The whole stamp-rotation machinery was undermined by its own owner.

This commit wires the same `OnTokenValidated → SecurityStampValidator.IsTokenRevokedAsync` hook into Auth's bearer options.

**Pin test.** New `tests/Planora.UnitTests/Services/AuthApi/Infrastructure/AuthJwtStampWiringTests.cs` builds the Auth infra container and asserts that `JwtBearerOptions.Events.OnTokenValidated` is non-null. If a future refactor removes the wiring, this test fails before the regression ships.

**Docs.**
- `docs/auth-security.md` § "Stamp enforcement coverage" — new coverage table listing how each service enforces the stamp.
- `docs/INVARIANTS.md` `INV-AUTH-4` — explicit clause that stamp rotation is meaningless without per-service enforcement; pointer to the coverage table and the new wiring test.
- `CHANGELOG.md`: this entry.

Email-change rotation was already in place via `ChangeEmailCommandHandler:100`; the earlier audit incorrectly flagged it as missing. No code change there — INVARIANTS now mentions it explicitly.

Tests: 711/711 (was 710/710, +1 wiring assertion).

Security: closes the stamp-bypass-on-Auth gap; brings the stamp coverage from 4/5 services to 5/5.

Refs: `Services/AuthApi/Planora.Auth.Infrastructure/DependencyInjection.cs`, `tests/Planora.UnitTests/Services/AuthApi/Infrastructure/AuthJwtStampWiringTests.cs`, `docs/auth-security.md`, `docs/INVARIANTS.md` `INV-AUTH-4`.

### PR-5 comments: drop avatar snapshot, always batch-enrich with 60s cache (2026-05-26)

The `TodoItemComment.AuthorAvatarUrl` column was a snapshot of the author's avatar at write time. It guaranteed that comments would *always* show stale avatars after the author updated their picture, because nothing invalidated the stored value. The fix here removes the column entirely and switches comment-listing to live batch enrichment via Auth gRPC, with an in-memory cache to keep paged reads cheap.

What changed:
- **Domain**: `TodoItemComment.AuthorAvatarUrl` removed. `Create` / `CreateGenesis` lose the optional `authorAvatarUrl` parameter.
- **Configuration**: column removed from `TodoItemCommentConfiguration`.
- **Migration**: new `RemoveCommentAvatarSnapshot` (2026-05-26) drops `AuthorAvatarUrl` from `todo_item_comments`. Down-migration adds it back as nullable varchar(2048).
- **Read path**: `GetCommentsQueryHandler` now batch-fetches all needed `AuthorId`s in one call. No more "skip if snapshot present, else live fallback" — there's one source of truth.
- **Write path**: `AddCommentCommandHandler` and `AddGenesisCommentCommandHandler` continue to return a DTO with the avatar URL — they pull it from the current user context (JWT claim) because the author *is* the caller. `UpdateCommentCommandHandler` resolves the author's current avatar via the same `IUserService` (cached call) to keep DTOs consistent.
- **Caching**: new `CachingUserService` decorator wraps `UserGrpcService`. `IMemoryCache` with 60 s TTL, 10 000-entry size cap. Negative results are cached too, so a deleted user doesn't trigger a gRPC stampede during a comment-thread refresh.

Why this is the right shape:
- Slack/Linear/Figma all serve avatars through a separate identity-service call with short-TTL caches rather than denormalizing the URL into every domain object that mentions a user. This PR adopts that pattern.
- Single source of truth: when a user uploads a new avatar, every comment thread reflects the change within 60 s without any cross-service event/backfill.

Tests (+4 in the suite, full = 710 green):
- `CachingUserServiceTests` (new) covers: same id served from cache on second call (1 inner call), partial cache hit only fetches missing ids, negative results cached (no stampede), empty input short-circuits.
- `WorkersAndCommentsHandlerTests` updated to inject `IUserService` into the new `UpdateCommentCommandHandler` ctor.

Breaking:
- `TodoItemComment.AuthorAvatarUrl` is gone — direct consumers (none in the public API) must read from the DTO instead.

Refs: `Services/TodoApi/Planora.Todo.Domain/Entities/TodoItemComment.cs`, `Services/TodoApi/Planora.Todo.Application/Features/Todos/{Queries/GetComments,Commands/{AddComment,AddGenesisComment,UpdateComment,CreateTodo}}/*.cs`, `Services/TodoApi/Planora.Todo.Infrastructure/Services/CachingUserService.cs`, `Services/TodoApi/Planora.Todo.Infrastructure/Migrations/20260526201043_RemoveCommentAvatarSnapshot.cs`, `docs/database.md`, `docs/architecture.md`.

### PR-3 deploy(fly): persistent volume for auth uploads (2026-05-26)

`planora-auth` now mounts a Fly volume at `/data/uploads` (3 GB initial size, single-attach per machine). `ASPNETCORE_WEBROOT=/data/uploads` is set in `[env]` so Kestrel writes the WebRoot to the volume rather than the container's ephemeral layer. Without this, every `fly deploy` would wipe every user's avatar — a showstopper for any production-ish use.

`Program.cs` now resolves WebRoot from `app.Environment.WebRootPath` (which respects `ASPNETCORE_WEBROOT`) and falls back to `ContentRootPath/wwwroot` for local dev. The change is transparent to local development.

Bootstrap (per region):

```powershell
flyctl volumes create planora_auth_uploads --app planora-auth --region ams --size 3
```

Doc updates: `deploy/fly/README.md` gains a new "Persistent volumes" section documenting the bootstrap and the future-state note that PR-4 (Cloudflare R2) will demote this mount to dev/fallback.

This PR is a no-op locally but unblocks `fly deploy` from being a destructive operation against user data.

### PR-2 avatar variants + content-hash paths + immutable cache (2026-05-26)

Productionizes the avatar storage layer. Three variants per upload (64/128/512 px) are encoded server-side via ImageSharp `ResizeMode.Crop` + Lanczos3, written under content-addressed URLs `/avatars/{userId:N}/{contentHash}/{size}.webp`, and served with `Cache-Control: public, max-age=31536000, immutable` + `X-Content-Type-Options: nosniff`.

Why this matters:
- **Bandwidth**: navbar thumbnails (32-40 px on screen) now pull the 64 px variant instead of the full-resolution source. Profile detail uses 512 px. Comment lists use 64 px.
- **Cache invalidation**: SHA-256 prefix of all variant bytes drives the path segment. Same bytes → same URL → CDN deduplicates; new bytes → new URL → no busting query-strings needed and `immutable` is safe.
- **Lifecycle**: every successful upload prunes the user's prior `{hash}/` subdirectory. Disk footprint stays at `~3 × 30 KB ≈ 90 KB` per user.
- **Service contract**: new `IAvatarStorage` (PutAsync / DeleteAsync) replaces the file-storage call in the upload handler. The legacy `IFileStorageService.SaveBytesAsync` stays available for non-avatar uploads (none today). Storage path-traversal guard remains.

Static-file serving: `Services/AuthApi/Planora.Auth.Api/Program.cs` adds an `OnPrepareResponse` filter that scopes the immutable cache to `/avatars/` only — other static assets (if added later) are untouched. `ServeUnknownFileTypes = false` denies content-sniffing.

Tests (+8 in the suite, full = 706 green):
- `UploadAvatarCommandHandlerTests`: now drives an `IAvatarStorage` mock; verifies canonical URL = medium variant URL and ProfilePictureUrl is persisted.
- `ImageSharpImageProcessorTests`: variant count + dimensions, EXIF stripped from every variant, deterministic 16-char content hash.
- `LocalAvatarStorageTests` (new): three files materialize under the hash subdir; older revisions pruned on next upload; DeleteAsync clears the whole user tree; empty Guid rejected.

Breaking:
- Avatar URL scheme changed from `/avatars/avatar-<guid>.webp` (PR-1) to `/avatars/{userId:N}/{hash}/{size}.webp`. Existing PR-1 URLs continue to resolve until next upload. No DB migration required — `User.ProfilePictureUrl` remains a relative-URL `varchar`.

Refs: `Services/AuthApi/Planora.Auth.Application/Common/Interfaces/{IAvatarStorage,IImageProcessor}.cs`, `Services/AuthApi/Planora.Auth.Infrastructure/Services/Common/{ImageSharpImageProcessor,LocalAvatarStorage}.cs`, `Services/AuthApi/Planora.Auth.Api/Program.cs`, `docs/INVARIANTS.md` `INV-AZ-5`.

### PR-1 avatar pipeline — server-side validation + ImageSharp re-encoding (2026-05-26)

**Security.** `POST /auth/api/v1/users/me/avatar` is now defended in depth. Previously the handler accepted any `IFormFile` bytes, wrote them to disk verbatim using the original filename, and trusted the client's `Content-Type`. A 100 MB EXE renamed to `.jpg` would have been stored exactly as uploaded. The new pipeline:

1. `[RequestSizeLimit(6 MB)]` + `[RequestFormLimits]` cap the multipart body at the edge before the handler runs.
2. `UploadAvatarCommandValidator` (FluentValidation) enforces 5 MB max and the `image/jpeg|png|webp` MIME whitelist.
3. `ImageSharpImageProcessor` re-checks magic bytes (JPEG `FF D8 FF`, PNG `89 50 4E 47 0D 0A 1A 0A`, WEBP `RIFF…WEBP`) regardless of declared `Content-Type` — spoofed headers cannot bypass it.
4. ImageSharp decodes the file, enforces 64×64..4096×4096, strips `ExifProfile` / `IccProfile` / `XmpProfile`, then re-encodes to WebP (lossy q=85). The output is a brand-new byte stream; polyglot files, embedded scripts, or metadata-borne PII cannot survive the round-trip.
5. `LocalFileStorageService` now validates the folder argument (rejects path separators / `..`), normalizes filenames, and refuses both `SaveBytesAsync` and `DeleteFile` operations that resolve outside the uploads root.

**Bug fix.** Removed a duplicate `AddScoped<IFileStorageService, FileStorageService>()` registration that was shadowing `LocalFileStorageService`. The `FileStorageService.cs` file is deleted — its `Guid.NewGuid()_{userFileName}` naming scheme was the actively-resolved one and would have allowed user-controlled extensions to land on disk.

**Breaking.** Avatar URLs are now always `/avatars/avatar-<guid>.webp`. Previous extensions (`.jpg`, `.png`) are no longer used. Existing avatar URLs on `User.ProfilePictureUrl` continue to resolve until the user re-uploads. Error codes split into `413 INVALID_FILE_SIZE` and `415 UNSUPPORTED_MEDIA_TYPE` (previously generic `400`).

**API.** New columns in `docs/API.md` § "Avatar upload" document limits, MIME whitelist, error codes, and output format. `docs/features.md`, `docs/auth-security.md` § "Avatar File Pipeline", and new invariant `INV-AZ-5` in `docs/INVARIANTS.md` capture the contract.

**Tests.** `+16` tests across `UploadAvatarCommandHandlerTests`, `ImageSharpImageProcessorTests`, and `LocalFileStorageServiceTests` cover authentication, processor rejection, EXIF stripping, magic-byte sniff, min-dimension floor, path-traversal guards, and external-URL preservation. Full suite: 718/718 (was 702/702).

**Packages.** `SixLabors.ImageSharp 3.1.11` added (latest stable; closes GHSA-2cmq-823j-5qj8 + GHSA-rxmq-m78w-7wmc).

Security: closes upload-side DoS, polyglot file, EXIF privacy leak, and shadow-DI registration footguns.

Refs: `Services/AuthApi/Planora.Auth.Application/Features/Users/{Commands,Validators,Handlers}/UploadAvatar/*`, `Services/AuthApi/Planora.Auth.Infrastructure/Services/Common/{ImageSharpImageProcessor,LocalFileStorageService}.cs`, `Services/AuthApi/Planora.Auth.Api/Controllers/UsersController.cs`, `docs/INVARIANTS.md` `INV-AZ-5`.

### Phase 2 T2.2 follow-on — Spectral OpenAPI linting + schema-id sanitisation (2026-05-26)

Locks the OpenAPI contract quality before any consumer (eventual TypeScript client, oasdiff comparison) lands. Two coordinated pieces.

Schema-id sanitisation at the Swashbuckle source. `PlanoraSwaggerExtensions.CustomSchemaIds` previously called `type.FullName` verbatim, which produced reflection-style closed-generic strings containing back-tick (`` ` ``), square brackets, commas, spaces, and equals signs — every one of those is illegal in an OpenAPI `$ref` URI-reference fragment per RFC 3986. Five `oas3-schema` errors fired on a baseline `auth.json` extraction. The new private `SanitizeSchemaId` helper collapses every non-`[A-Za-z0-9.]` run into a single underscore via a compiled regex and trims trailing underscores. The mapping is deterministic, distinct CLR FullNames never collide, and the resulting id stays human-readable. Nine unit tests pin the contract: plain FullName preserved verbatim; generic brackets replaced; nested-type plus-separator normalised to dot; reflection-style assembly-qualified noise (back-tick + `[[...]]`) collapsed; null / empty / underscored / digit / dot inputs handled; determinism (same input → same id); distinct inputs (e.g. `Result<UserDto>` vs `Result<TodoDto>`) never collapse to the same id.

Spectral OpenAPI linting in CI. New `.spectral.yaml` at the repo root extends the standard `spectral:oas` ruleset and tunes severities — contract-stability rules (`oas3-schema`, `operation-success-response`, `path-keys-no-trailing-slash`, `oas3-valid-media-example`, `oas3-valid-schema-example`, `operation-operationId-unique`, `operation-operationId-valid-in-url`) are **error** and gate the merge; documentation niceties (`info-description`, `operation-description`, `tag-description`, `oas3-parameter-description`, `oas3-api-servers`, `info-contact`, `info-license`) are downgraded to **hint** so they surface in the job log without blocking. The controller XML doc coverage will close these over time; today the OpenAPI artifact emits 76 warnings + 66 hints across auth alone, all of which need `[SwaggerOperation]` / XML-doc additions on controllers, not framework fixes. `operation-tag-defined` and `operation-operationId` stay at **warn**.

`.github/workflows/openapi.yml` adds a "Lint with Spectral" step per matrix job (auth / category / todo / messaging / realtime) using `npx @stoplight/spectral-cli@latest lint --format=stylish --fail-severity=error`. After the fix, baseline `auth.json` runs at 0 errors, 76 warnings, 66 hints — the previous five `oas3-schema` errors are gone.

`.gitignore` adds `openapi/` so local extraction (`dotnet swagger tofile --output openapi/<service>.json`) never accidentally lands in a commit. The CI workflow continues to create and upload its own copy.

New invariant `INV-API-4` in `docs/INVARIANTS.md` codifies the linting contract and the sanitiser's role. `docs/testing.md` "OpenAPI Artifacts (per PR)" section is rewritten to walk through both pieces and the linked test suite.

Verification: `dotnet build Planora.sln -warnaserror` is 0/0; `dotnet test` passes 733/733 (was 725/725, +8 new schema-id sanitiser tests). Local Spectral run against a fresh `auth.json` exits 0.

Refs: `.spectral.yaml`, `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Configuration/PlanoraSwaggerExtensions.cs` (`SanitizeSchemaId`), `docs/INVARIANTS.md` `INV-API-4`, off-repo MASTER_PLAN Phase 2 T2.2 follow-on.

### Phase 3 T3.2 — outbox dead-letter terminal state, retry-cycle bug fix (2026-05-26)

Fixes a real bug in the outbox processor where a message that hit `MaxRetries`
was left in `Status=Failed` with a stale `NextRetryUtc` in the past, so the
polling `WHERE Status==Pending OR (Status==Failed AND NextRetryUtc<=now)`
re-picked the row on every cycle forever. Each cycle emitted a
`retry_exhausted` metric event and consumed a slot in the per-batch limit
(20 messages per pass), starving newer messages from being processed.

The fix lands as four small atomic moves:

- New terminal state `OutboxMessageStatus.DeadLettered = 4` added to the
  enum. Enum-value additions are forward-compatible with the existing
  `int`-typed status column — no EF migration required across Auth /
  Category / Messaging / Todo outbox tables.

- `OutboxMessage.MarkAsFailed` auto-transitions to `DeadLettered` when
  `RetryCount` reaches `MaxRetries`, clearing `NextRetryUtc` so the
  polling WHERE clause cannot re-pick the row. The state machine now
  owns the retry/dead-letter decision — the processor never sets
  `Status` directly.

- New `OutboxMessage.MarkAsDeadLettered(reason)` for hard non-recoverable
  failures (type-not-found, deserialize-failed) that should not consume
  the retry budget. The processor's `catch` block uses it for the two
  shape-error branches.

- `OutboxMessage.CanRetry` tightened: returns false once the row is
  `DeadLettered` or `Processed`, not just on retry-count.

- `OutboxMessage.IsDeadLettered` convenience predicate for the
  processor's outcome-tag decision.

- `OutboxProcessor.cs` catch block simplified — the `(CanRetry ? : )`
  branch is gone; the entity decides. The outcome tag is now derived
  from `message.IsDeadLettered` after the SaveChanges, so a single code
  path covers both "still recoverable" and "just dead-lettered". The
  dead-letter event also writes a distinct ERROR log line so the row's
  final state shows up in Loki searches.

Observability changes are doc-only at the metric level — the existing instruments already cover this:

- `planora.outbox.messages{outcome="retry_exhausted"}` already existed —
  its description in `docs/observability.md` is rewritten to make the
  four "dead-letter" outcomes explicit: `retry_exhausted`,
  `type_not_found`, `deserialize_failed` (all terminal) plus the
  still-recoverable `failed`.

- `PlanoraOutboxPoison` alert rule extended to fire on
  `outcome=~"retry_exhausted|type_not_found|deserialize_failed"` so the
  on-call gets paged for ALL three terminal-failure outcomes, not just
  retry exhaustion. Annotation includes the operator's replay procedure
  (DeadLettered -> Pending after fixing the root cause).

Regression tests live in the new `tests/Planora.UnitTests/Services/Infrastructure/OutboxMessageStateMachineTests.cs`
pins the state machine down with nine cases:

- new message is Pending with full retry budget;
- MarkAsProcessed is terminal;
- 1st failure: 1-minute back-off, RetryCount=1;
- 2nd failure: 5-minute back-off, RetryCount=2;
- retry-budget exhaustion: status=DeadLettered, NextRetryUtc=null, RetryCount=MaxRetries (the bug fix this file exists to pin);
- MarkAsDeadLettered skips the retry budget entirely;
- MarkAsDeadLettered after partial retries preserves RetryCount;
- the polling-predicate REPRODUCTION never matches a dead-lettered row (the historical bug was the second clause matching it);
- CanRetry is false once processed.

Invariant `INV-COMM-3a` in `docs/INVARIANTS.md` codifies the entity-owned state machine: the processor never sets `Status` directly. Future changes that touch the outbox state machine must go through `MarkAsFailed` / `MarkAsDeadLettered` and the regression suite catches shortcuts.

Verification: `dotnet build Planora.sln -warnaserror` is 0/0; `dotnet test` passes 725/725 (was 716/716, +9 new outbox state-machine tests). No EF migration is required.

Refs: docs/INVARIANTS.md INV-COMM-3a, docs/observability.md, off-repo MASTER_PLAN Phase 3 T3.2.

### Phase 3 T3.5 — security-stamp rotation expanded to 2FA-disable, revoke-all-sessions, account-delete (2026-05-26)

`INV-AUTH-4` previously documented only password-change as a stamp-rotating event. Three additional command handlers now also rotate the stamp on success:

- **`Disable2FACommandHandler`** — disabling 2FA reduces the account's security posture; rotating forces re-authentication on every device, eliminating the window where a stolen access token could continue to operate against a now-weaker account.
- **`RevokeAllSessionsCommandHandler`** — this command's raison d'être was previously broken. Refresh-token revocation alone leaves outstanding access tokens valid until they expire on their own; the stamp rotation makes "revoke all sessions" actually invalidate the live access tokens, not just future refreshes.
- **`DeleteUserCommandHandler`** — outstanding access tokens must not continue to hit endpoints whose handlers do not separately check `IsDeleted`. Rotation is published BEFORE the cross-service `UserDeletedIntegrationEvent` so the local session is invalidated even if the event publish fails and the deletion is retried later.

The new logic runs **only on successful execution**. Five new regression tests pin the contract down:

- `Disable2FA_ShouldRotateSecurityStamp_OnSuccess`
- `Disable2FA_ShouldNotRotateSecurityStamp_OnFailure` (wrong-password must not DoS the user)
- `RevokeAllSessions_ShouldRotateSecurityStamp_OnSuccess`
- `RevokeAllSessions_ShouldNotRotateSecurityStamp_OnInvalidPassword`
- `DeleteUser_ShouldNotRotateSecurityStamp_OnInvalidPassword`

The existing `DeleteUser_ShouldSoftDeleteDeactivatePersistAndPublishCleanupEvent` test was extended with a `SecurityStamp.Verify(...Times.Once)` assertion at its end.

Stamp rotation is NOT triggered on 2FA enable or 2FA confirm — enabling strengthens the account; invalidating live sessions there would be friction without security benefit.

`docs/INVARIANTS.md` `INV-AUTH-4` rewritten to list the six rotating commands exhaustively. `docs/auth-security.md` "Access Token Invalidation (Security Stamp)" section gains a per-handler rationale table and references the new tests.

Verification: `dotnet build Planora.sln -warnaserror` 0/0; tests **716/716 passed** (was 711/711, +5 new regression tests).

### Phase 2 entry — OpenAPI artifact per service, Swagger surface unified (2026-05-26)

Closes Phase 2 T2.2 from the master plan. The OpenAPI document is now a checked-in CI contract on every PR that touches the controller surface; the foundation for the generated TypeScript client lands without any frontend code change yet.

- **Unified Swagger wiring** — new `BuildingBlocks.Infrastructure.Configuration.PlanoraSwaggerExtensions` with `AddPlanoraSwaggerGen(title, description, documentVersion = "v1", infoVersion = null)` and `UsePlanoraSwagger(env, documentTitle)`. The middleware mounts only when the environment is `Development` or `Staging`; production never exposes the interactive Swagger UI (information-disclosure concern). Schema ids use `type.FullName` for stability across services. JWT bearer is the only declared security scheme. The shared helper added `Swashbuckle.AspNetCore` + `.Annotations` references to `BuildingBlocks.Infrastructure.csproj` so the per-service projects need no extra package reference.

- **Per-service registration** — `AddPlanoraSwaggerGen` + `UsePlanoraSwagger` wired in Category, Todo, Messaging, and Realtime `Program.cs` (Auth was already wired; its `SwaggerConfiguration.cs` becomes a thin wrapper around the BuildingBlocks helper that preserves the `Info.Version = "v1.0.0"` semantic version pinned by `AuthApiConfigurationTests`). The Gateway is intentionally skipped — Ocelot routes are derived from `ocelot*.json` and not from controller metadata.

- **CLI tool** — `Swashbuckle.AspNetCore.Cli` 6.9.0 added as a local tool in `.config/dotnet-tools.json` alongside the existing `dotnet-stryker`. Local extraction works after `dotnet tool restore`:

  ```powershell
  dotnet swagger tofile --output openapi/<service>.json `
    Services/<service>Api/Planora.<Service>.Api/bin/Release/net9.0/Planora.<Service>.Api.dll v1
  ```

- **CI workflow `.github/workflows/openapi.yml`** — triggers on PRs touching `BuildingBlocks/**`, `Services/**`, `GrpcContracts/**`, `.config/dotnet-tools.json`, `Directory.Packages.props`, or this workflow itself. Provides Postgres + Redis + RabbitMQ as GitHub Actions services so the boot path completes deterministically (Redis/RabbitMQ failures degrade gracefully but providing both keeps timing predictable). Matrix-fans across the five HTTP services (auth, category, todo, messaging, realtime). Each artifact passes a `jq -e '.openapi and .info.title and .paths'` validation before upload; a malformed document fails the job rather than shipping as a zero-byte file. Per-service artifacts have 30-day retention.

- **Invariant** — `INV-API-3` codifies the convention: services do not call `services.AddSwaggerGen()` directly; the OpenAPI surface is the CI artifact, not a runtime endpoint exposed in production.

- **Docs** — `docs/INVARIANTS.md`, `docs/testing.md`, `docs/deployment.md`, `docs/codebase-map.md`, `docs/ROADMAP.md` reflect the new surface; the previous "OpenAPI artifact" confirmed-gap row is removed (closed).

Verification: `dotnet build Planora.sln -warnaserror` remains 0/0. Tests are 711/711 (no change in count — the new wiring is exercised by the existing `AuthApiConfigurationTests`, which pinned both the `Info.Version = "v1.0.0"` semantic version and the bearer security scheme; the test caught the initial refactor's conflation of the route version and the info version and was fixed before merge).

### Phase 2 / Phase 3 entry-point — CSRF coverage ADR, per-user rate limit, SLOs, caching doc (2026-05-26)

Two coordinated commits land the lowest-risk Phase 2 / Phase 3 entries and a full documentation hardening pass. Backend `dotnet build -warnaserror` remains clean (0/0); tests are 711/711 (was 703/703, +8 new partition-key tests).

- **Per-user rate-limit partition** (`3de9a3b`, Phase 3 T3.7): `ServiceCollectionExtensions.PartitionKey` now resolves to `u:<sub>` for authenticated requests and `ip:<address>` for anonymous, with the literal `anon` as the fallback when no remote IP is available. The previous IP-only model collapsed every user behind a shared NAT (corporate proxy, mobile carrier CGN, household router) into one bucket. The two namespace prefixes (`u:` and `ip:`) prevent any user id text from ever colliding with a real IP in the Redis key space. Eight unit tests in `tests/Planora.UnitTests/Services/Infrastructure/RateLimitPartitionKeyTests.cs` pin the precedence down.

- **ADR-0005 — CSRF middleware is bounded to Auth API** (Phase 2 T2.6): closed-form record documenting why CSRF middleware is intentionally registered only on Auth API. Auth is the only service that accepts a cookie credential (the refresh token, path-scoped to `/auth/api/v1/auth`); the four other services are bearer-only and have no CSRF surface. `withCredentials: true` on the frontend axios clients is correct because the refresh-cookie path scoping at the server side guarantees the cookie never reaches non-Auth services. The ADR enumerates the two rejected alternatives (register everywhere; drop `withCredentials` per-axios-instance) and locks the future contract: any new service that adds cookie-based auth must add the middleware in the same change.

- **New `docs/observability.md`** entry was already cross-linked; this audit adds the operational supplements:
  - **`docs/slo.md`** — baseline SLO catalogue with PromQL definitions: Gateway availability (≥99.5% / 28d), authenticated read p95 (≤400 ms), login p95 (≤800 ms), outbox freshness p95 (≤60 s), realtime fan-out (provisional). Includes the error-budget policy.
  - **`docs/caching.md`** — single reference for every cached resource, TTL convention, invalidation rules (outbox-driven, idempotent), and explicit "what is NOT cached, and why" list.

- **`docs/OPERATIONS.md` runbook expansion**: now includes the three-probe health surface, deployment commands (tag push + `gh workflow run` reroll), Migrator operations (local + Fly machine run), observability activation, and an Incident Pointers table that covers `/health/ready` 503s, CD pipeline failures, migration failures, outbox backpressure, gRPC service-key mismatch alerts, CSRF spikes, and silent Loki.

- **`docs/ROADMAP.md` refresh**: replaces the pre-2026-05-26 snapshot with the current state — Phase 0 / Phase 1 closed, Phase 2+ confirmed-gaps table, master-plan-ordered recommendations with P1 / P2 / P3 / P4 priority labels, and the Phase-1 follow-ups that await external accounts (Grafana Cloud, Fly.io, Postgres provider). Now references ADR-0005.

- **`docs/glossary.md` extension**: thirty new terms covering OpenTelemetry / OTLP / Grafana Cloud / Loki / Fly.io / `fly.toml` / FLY_API_TOKEN / Cosign / CycloneDX SBOM / Dependabot / k6 / SLI / SLO / Error budget / RED metrics / Stryker.NET / `INV-XYZ-N` / ADR / BuildingBlocks / ConfigurationValidator / PlanoraMetrics / Planora.Migrator / Rate-limit partition key / Security stamp / Trace context / TryAddLokiSink / Verify-Phase1-Prereqs.ps1.

- **`docs/faq.md`**: license answer updated (no longer MIT), deployment guide answer rewritten around Fly.io, three new entries (CSRF coverage rationale, observability activation, prereq verification script).

- **`docs/getting-started.md`**: health-endpoint table extended with the `/health/live` + `/health/ready` split and the intentional-503-on-readiness note.

- **`docs/index.md`**: documentation map adds the new operational docs.

### Phase 1 closure — Grafana Loki + Fly.io CD + frontend OTel propagation (2026-05-26)

Three coordinated commits close the remaining Phase 1 work that does not require external account registration. Everything is **no-op-safe**: nothing exporters, deploys, or ships logs until a single secret is set per integration. Backend remains `dotnet build -warnaserror` clean (0/0) with 703/703 tests passing (+6 new Loki tests on top of the previous 697); frontend 360/360 tests pass (+9 new traceparent tests on top of 351).

- **Grafana Loki Serilog sink** (`8c092d0`): `BuildingBlocks.Infrastructure.Logging.SerilogConfiguration.TryAddLokiSink` registers a `Serilog.Sinks.Grafana.Loki` 8.3.0 sink when `LOKI_URL` (or `Serilog:Loki:Url`) is configured. Both the `WebApplicationBuilder` and `IHostBuilder` Serilog entry points call the same helper; basic-auth credentials are accepted from `LOKI_USER` / `LOKI_TOKEN` (or the matching config keys). Labels emitted: `service_name`, `environment` — cardinality is intentionally bounded. Six new unit tests cover the false/true return contract, env-var fallback, credential acceptance, and the argument guards; the `EnvironmentScrub` helper isolates each test from the CI runner's ambient `LOKI_*` state. Documented as `INV-OBS-7`.

- **Fly.io CD pipeline + bootstrap automation** (`fbe043b`): new `.github/workflows/cd.yml` triggers on `v*` tag pushes and `workflow_dispatch`, running preflight → migrate (`flyctl machine run --rm planora-migrator -- --all`) → service rollout (`auth → category → todo → messaging → realtime`, strictly serial via `max-parallel: 1`) → gateway → `/health/ready` smoke. Single-flight via `concurrency: cd-fly-prod` with `cancel-in-progress: false`. Fails fast with an actionable error message when the `FLY_API_TOKEN` repository secret is missing. New `deploy/fly/setup.ps1` idempotently runs `flyctl apps create` for every manifest; `deploy/fly/set-secrets.ps1` reads a gitignored `deploy/fly/.env.fly` and stages the per-app secret matrix via `flyctl secrets set --stage` (with a `-DryRun` mode); `deploy/fly/.env.fly.example` is the annotated template. `scripts/Verify-Phase1-Prereqs.ps1` is a read-only checker covering flyctl auth, per-app existence, the five mandatory secrets per app, the local `dotnet build -warnaserror` state, and the `FLY_API_TOKEN` GitHub repository secret. `.gitignore` excludes `deploy/fly/.env.fly` (the example template stays via explicit re-include).

- **Frontend W3C traceparent propagation** (`5bd6e83`): new `frontend/src/lib/trace.ts` ships a 50-line in-bundle W3C trace-context generator (no OpenTelemetry SDK dependency — `@opentelemetry/sdk-trace-web` would have added ~80 KB to the bundle for a small need). The axios request interceptor in `frontend/src/lib/api.ts` now sets `traceparent: 00-<32 hex>-<16 hex>-01` on every outbound request that does not already carry one. The backend `AddPlanoraTelemetry` pipeline extracts the context through the AspNetCore instrumentation, so frontend → gateway → service → DB spans roll up into a single trace as soon as `OTEL_EXPORTER_OTLP_ENDPOINT` is set on every Fly app. Nine new unit tests cover trace-id / span-id shape and uniqueness, `newTraceparent`, `traceparentForExistingTrace` reuse semantics, all-zero rejection, and `extractTraceId` null-safety for malformed input. Documented as `INV-OBS-8`.

- **New operational guide — [`docs/observability.md`](docs/observability.md)**: single reference for the entire observability surface. Covers the three signal pipelines, the end-to-end trace path, the five custom `PlanoraMetrics` instruments, activation walkthroughs for Grafana Cloud OTLP and Loki, suggested PromQL queries (Gateway RED / security signals / outbox health), four ready-to-paste alert rules, sensitive-data considerations (EF SQL capture, log redaction, probe traffic filter), and answers to the common operational questions. `docs/configuration.md`, `docs/deployment.md`, `docs/secrets-management.md`, `docs/INVARIANTS.md`, `docs/index.md`, `docs/codebase-map.md`, `README.md` all gain cross-references.

- **Bootstrap workflow documented in `docs/deployment.md`**: new "Bootstrap workflow — zero to deployable in three commands" section captures the exact sequence (`setup.ps1` → fill in `.env.fly` → `set-secrets.ps1` → `flyctl auth token | gh secret set FLY_API_TOKEN` → `Verify-Phase1-Prereqs.ps1`). Deployment artifacts table now lists every script and the CD workflow.

### License — relicensed to a restrictive source-available study-only license (2026-05-26)

- `LICENSE` is no longer MIT. The project is now published under a deliberately restrictive **Planora Source-Available License (Study-Only)**: the public is permitted to read, run on a personal machine, and quote short attributed excerpts of the source code; every other use — including but not limited to copying into another repository, forking publicly, deploying, distributing, sublicensing, integrating into another product or service, mirroring, repackaging, or using the code (in source or compiled form) as input to model training / fine-tuning / agent systems — requires prior written permission from the copyright holder. README license badge and the README License section were rewritten to match. This is **not** an open-source license; it is a "look but don't use" license.

### Phase 0 / Phase 1 engineering audit follow-through (2026-05-26)

Nine commits ship together as a single coordinated audit batch, deliberately additive: no service behavior change, every commit verified by `dotnet build -warnaserror` (0 warnings, 0 errors) and `dotnet test` (697/697 passed).

- **Runtime user uploads excluded from version control** (`1e06d4a`): `.gitignore` now excludes `Services/AuthApi/Planora.Auth.Api/wwwroot/avatars/` plus the generic `**/wwwroot/avatars/` and `**/wwwroot/uploads/` patterns so any future upload surface gets the same protection by default. Closes the path where avatar binaries could land in a PR diff after first upload.

- **Engineering guardrails baseline** (`7f80b44`): `.editorconfig` unifies charset/EOL/indent across the repo (LF for code, CRLF for `.cs`/`.ps1`, 4 spaces for C#, 2 for web). `.gitleaks.toml` extends the gitleaks default ruleset with Planora-specific detectors (`JwtSettings__Secret`, `GRPC_SERVICE_KEY`, `RABBITMQ_PASSWORD`, `Email__Password`, inlined Postgres/Redis passwords, generic high-entropy SECRET/TOKEN/KEY) and an allowlist for environment-variable interpolation forms. `docs/INVARIANTS.md` records closed-form architectural rules every reviewer is expected to uphold. A new `sbom` job in `.github/workflows/security.yml` emits CycloneDX SBOMs for the .NET solution (via the `CycloneDX` global tool) and the frontend npm tree (via `@cyclonedx/cyclonedx-npm`), uploaded as a 90-day-retention artifact.

- **Health probe split across all services** (`1bb1df2`): every service and the API Gateway now expose `/health/live` (process liveness — match checks tagged `live`), `/health/ready` (dependencies reachable — match checks tagged `ready`), and the aggregate `/health` (backwards-compatible — used by docker-compose). Wiring is centralized in `BuildingBlocks.Infrastructure.Extensions.HealthCheckExtensions.MapPlanoraHealthEndpoints`; services no longer call `MapHealthChecks` directly. The Gateway also drops a previously-shadowed duplicate `MapGet("/health", …)` that coexisted with `MapHealthChecks` and only worked because an earlier `UseWhen` short-circuit hid the ambiguity. Documented as `INV-OBS-4`.

- **Centralized OpenTelemetry across all services** (`3791212`): a single `TelemetryConfiguration.AddPlanoraTelemetry(IConfiguration, defaultServiceName)` extension in `BuildingBlocks.Infrastructure.Logging` wires traces (AspNetCore + HttpClient + Entity Framework Core) and metrics (AspNetCore + HttpClient + Runtime), tags requests with the standard resource attributes (`service.name`, `service.version`, `service.instance.id`, `service.namespace=planora`, `deployment.environment`), and registers the OTLP gRPC exporter **only when `OTEL_EXPORTER_OTLP_ENDPOINT` or `OpenTelemetry:OtlpEndpoint` is set** — when unset the pipeline runs in-process with no exporters, no background connections, no log noise, so this commit is safe to land in every environment. Independent `Tracing:Enabled` / `Metrics:Enabled` kill switches, `ConsoleExporter:Enabled` for local debugging, `Tracing:CaptureDbStatementText` for PII control. `/health*` paths are excluded from request tracing. The AuthApi-side `AddOpenTelemetryConfiguration` becomes a thin wrapper around the BuildingBlocks extension, preserving the exact signature the existing OpenTelemetryExtensionsTests and AuthApiConfigurationTests pin down. The unused `AddEnterpriseTelemetry` stub (hardcoded to `http://jaeger:4317`) was removed. Documented as `INV-OBS-5`; configuration keys catalogued in `docs/configuration.md` under "OpenTelemetry (Observability)".

- **Custom Planora metrics — CSRF, outbox, gRPC trust** (`a0450aa`, `d4f96c8`): `BuildingBlocks.Infrastructure.Observability.PlanoraMetrics` exposes a single shared `Meter("Planora.BuildingBlocks")` (auto-discovered by the wildcard meter subscription in `AddPlanoraTelemetry`) with five instruments — `planora.csrf.rejections{reason}` counter (`reason` ∈ {`missing_header`, `missing_cookie`, `mismatch`}), `planora.grpc.unauthenticated{reason}` counter (`reason` ∈ {`missing_key`, `short_key`, `mismatch`}), `planora.outbox.messages{outcome}` counter (`outcome` ∈ {`processed`, `failed`, `type_not_found`, `deserialize_failed`, `retry_exhausted`}), `planora.outbox.batch.duration` histogram (seconds), and `planora.outbox.message.age` histogram (seconds — the backpressure signal). `CsrfProtectionMiddleware` now returns a `(bool, reason)` tuple to populate the rejection tag; `ServiceKeyServerInterceptor` splits its reject branches so each rejection carries an actionable tag; `OutboxProcessor` records per-message lag, per-batch duration, and outcome counters across every terminal branch. Documented as `INV-OBS-6`; tag cardinality is finite and audited before merge.

- **Fly.io deployment manifests** (`a25999f`): eight `deploy/fly/*.fly.toml` manifests (gateway, auth, category, todo, messaging, realtime, outbox-worker, migrator) plus `deploy/fly/README.md`. Manifests are deployment templates — no secrets; secrets layer in via `flyctl secrets set`. Edge (`planora-gateway`) is always-on with request-count concurrency; internal services auto-stop on idle with request-count concurrency; `planora-realtime` is always-on with connection-count concurrency because SignalR holds long-lived sockets. Every app's probes point at `/health/live` and `/health/ready` introduced in `1bb1df2`. The `outbox-worker` and `migrator` manifests are reserved — their Dockerfile paths point at not-yet-existing projects so the naming and secret-set conventions are fixed before the workstreams land.

- **Planora.Migrator CLI + per-PR migration scripts artifact** (`f47c283`): new `tools/Planora.Migrator/` console project added to `Planora.sln`. CLI flags: `--all`, `--service <name>` (auth, category, todo, messaging), `--list-pending`, `--connection-string <override>`. Iterates the four DB-owning services in declaration order, instantiates each DbContext from a minimal DI graph (no Redis, no RabbitMQ, no HTTP), reports pending migrations, and either prints or applies them. Auth and Category DbContexts get a `NoOpDomainEventDispatcher` because their constructors require one but migrations never raise events. Exit codes: 0 success, 64 bad args, 70 one or more services failed. Multi-stage Dockerfile on `mcr.microsoft.com/dotnet/runtime:9.0` — no ASP.NET, no curl, no shell; non-root `USER appuser`. New `.github/workflows/migrations.yml` matrix-fans across the four services and uses `dotnet ef migrations script --idempotent` to attach one SQL artifact per service to every PR whose schema-relevant paths change. Replaces the unsafe "every service `Database.MigrateAsync()` at startup" pattern that races under HA. Documented as `INV-FLOW-4`. Services still auto-migrate at startup for now; the cutover happens when the CD pipeline lands.

- **k6 perf baseline + on-demand perf-smoke workflow** (`804c7a3`): new `perf/k6/` directory with shared helpers (`lib/api.js` — CSRF bootstrap, register, login) and two scenarios (`scenarios/login.js`: warmup 10s @ 1 VU → ramp 20s @ 5 VUs → steady 30s @ 10 VUs, thresholds `login p95<800ms` / `p99<1500ms` (steady), `csrf p95<200ms`, `http_req_failed<1%`; `scenarios/todo-list.js`: warmup 10s → steady 30s @ 10 VUs, thresholds `todo_list p95<400ms` / `p99<800ms`). Per-request `name:` tags and per-stage `stage:` tags let thresholds and downstream analysis slice by endpoint without grepping URLs. New `.github/workflows/perf-smoke.yml` runs on `workflow_dispatch` only (load tests are deliberately not on every PR) — stands up the full docker-compose stack, installs k6 from the official APT repo, runs the chosen scenario or all, uploads the k6 summary and raw JSON as a 30-day-retention artifact, then tears the stack down. Closes Phase 0 T0.1 from the off-repo master plan.

### Audit follow-up — correctness, config, and hygiene (2026-05-22)

- **Medium — soft-delete leak on `GetByIdAsync` (BuildingBlocks)**: the shared `BaseRepository.GetByIdAsync` queried by id only, while every sibling method filtered `!IsDeleted`; `TodoDbContext` has no global query filter, so a soft-deleted entity surfaced by id. Added the `!IsDeleted` predicate (`BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Persistence/BaseRepository.cs`).
- **Medium — soft-delete filter bypass on Auth `GetByIdAsync`**: AuthApi's own `BaseRepository.GetByIdAsync` used `FindAsync`, which bypasses EF Core global query filters entirely — a soft-deleted `User`/`Friendship` could be returned despite the configured `HasQueryFilter`. Switched to `FirstOrDefaultAsync` so the filter applies (`Services/AuthApi/Planora.Auth.Infrastructure/Persistence/Repositories/BaseRepository.cs`).
- **Medium — soft-deleted categories leaked through reads**: `CategoryDbContext` had no soft-delete query filter, so `GetByIdAsync`, `FindAsync`, `ExistsAsync`, `CountAsync` and `GetPagedAsync` returned/counted deleted categories. Added a global `HasQueryFilter` on `Category` (`Services/CategoryApi/Planora.Category.Infrastructure/Persistence/Configurations/CategoryConfiguration.cs`).
- **Medium — friendship-revocation share cleanup untestable and non-atomic**: `TodoRepository.RemoveSharesBetweenUsersAsync` issued two separate `ExecuteDeleteAsync` calls; `ExecuteDeleteAsync` is unsupported by the EF Core InMemory test provider, so the path was unverified, and a partial failure could leave shares removed in only one direction. Rewritten to load both directions in one query and remove them under a single `SaveChangesAsync` (`Services/TodoApi/Planora.Todo.Infrastructure/Persistence/Repositories/TodoRepository.cs`).
- **Low — no optimistic concurrency control**: `TodoItem`, `Category` and `Friendship` are mutable aggregates with no concurrency token, so concurrent updates were silently last-write-wins (the in-memory `if (Status != Pending)` guard on `Friendship` does not protect across transactions). Each now uses PostgreSQL's `xmin` system column as a concurrency token (configured as a shadow property, guarded by `Database.IsNpgsql()` so the InMemory test provider is unaffected — no schema column or migration required). The global exception handler already maps the resulting `DbUpdateConcurrencyException` to HTTP 409 (`Services/*/Infrastructure/Persistence/*DbContext.cs`).
- **Low — dead code removed**: `EventBus.cs`/`EventBusOptions.cs` (a `dynamic`-typed compatibility shim with ~14 empty `catch` blocks, never registered — `IEventBus` is always `RabbitMqEventBus`); `TodoHub.cs` (a SignalR hub that was never mapped and exposed client-callable `Notify*` methods taking an arbitrary `userId`); a `Realtime.Domain` → `BuildingBlocks.Infrastructure` project reference (a DDD layering inversion on a project with no source files); and a redundant second `AddGrpc()` in AuthApi `Program.cs`.
- **Low — config gaps**: `docker-compose.yml` now passes `GrpcSettings__ServiceKey` to `api-gateway`; the stale Category gRPC address `:5282` in TodoApi `appsettings.Docker.json` corrected to `:81`; `e2e.yml` actions pinned to commit SHAs; Dependabot gained the `docker` ecosystem; the unused `INCLUDE_ERROR_DETAIL` variable removed from the env templates and docs.
- **Tests**: four `RabbitMqStartupHostedService` tests were rewritten to await the first connection probe deterministically instead of assuming `BackgroundService.ExecuteAsync` runs synchronously inside `StartAsync`. New regression tests cover `GetByIdAsync` soft-delete behavior for the BuildingBlocks, Auth and Category repositories and the two-directional `RemoveSharesBetweenUsersAsync` cleanup. Backend: 701 tests pass; build is warning-clean under `-warnaserror`.

### Security tooling — CI scanning (2026-05-22)

- **CodeQL SAST**: `security.yml` now runs GitHub CodeQL static analysis for `csharp` and `javascript-typescript` with the `security-extended` query suite and buildless analysis (`build-mode: none`). Results are published as SARIF to the repository Security tab.
- **Trivy IaC scan**: a Trivy misconfiguration scan covering Dockerfiles and `docker-compose.yml` was added, with SARIF upload. Introduced in report mode (findings are surfaced, the job does not hard-fail) so the team can ratchet to enforcement once the baseline is clean.
- All workflow action references are pinned to commit SHAs, validated with `actionlint`.

### Distributed rate limiting (2026-05-22)

- **Phase 2 — Redis-backed rate limiter**: the previous `PartitionedRateLimiter` was strictly in-memory, so deploying every service behind a load balancer multiplied each configured limit by the replica count (a five-instance deployment effectively allowed `5×` the documented `login`, `register`, `auth` and global caps). `AddConfiguredRateLimiting` now takes an `IConfiguration` and, when `RateLimiting:Backend = Redis`, builds the global and named policies via `RedisRateLimitPartition.GetFixedWindowRateLimiter` from `RedisRateLimiting.AspNetCore`, sharing per-IP counters across every replica through Redis. With the setting absent (tests and local dev) the in-memory limiter is used unchanged, so no existing test exercises the new path. `docker-compose.yml` now sets `RateLimiting__Backend: Redis` on every service. Documentation (`docs/auth-security.md`, `docs/configuration.md`) reflects the two backends.

### Mutation testing (2026-05-22)

- Added Stryker.NET as a restorable local tool (`.config/dotnet-tools.json`) with `stryker-config.json` scoping a run to the security-critical hidden-shared-todo visibility helpers (`HiddenTodoDtoFactory`, `TodoViewerStateResolver`).
- The initial run scored 75% — five mutants survived in pure redaction logic, revealing branches the existing handler-level tests did not pin down. Added `HiddenTodoVisibilityTests.cs` with nine direct unit tests (owner vs. non-owner masking, `UserId` redaction, stranger/multi-recipient share detection, legacy global-hide inheritance) and exposed the `internal` helpers to the test project via `InternalsVisibleTo`. The mutation score for that logic is now 95.83%.
- Added a second scoped config `stryker-auth.json` for the auth security modules (`PasswordValidator`, `TwoFactorService`, `RecoveryCodeService`). The baseline of 65.70% revealed gaps on the length-policy and pattern-detection boundaries: there were no tests pinning down the minimum/maximum length thresholds, the `i <= length - n` loop bounds in `HasSequentialCharacters` / `HasRepeatingCharacters`, the three length tiers in `CalculatePasswordStrength`, or the 70% unique-char threshold. Added ten boundary tests covering each branch. The auth score is now 87.32%; the three remaining mutants are documented equivalent mutants (logger-only branches in HIBP and the `StringSetAsync` `keepTtl` parameter masked by `When.NotExists`). Both configs ignore the `string` mutator (cosmetic) and the auth config also ignores the `statement` mutator (logger-call removal — equivalent).
- `StrykerOutput/` is git-ignored; `docs/testing.md` documents how to run both configs.

### Architecture tests (2026-05-22)

- Added `tests/Planora.UnitTests/Architecture/ArchitectureTests.cs` using `NetArchTest.Rules`. The suite enforces the Clean Architecture / DDD dependency rule automatically: every `*.Domain` assembly is asserted to have no dependency on infrastructure concerns (`*.Infrastructure`, EF Core, ASP.NET Core, Npgsql, Redis, RabbitMQ, gRPC); `BuildingBlocks.Domain` must not depend on the Application or Infrastructure layers; and no `*.Application` project may depend on a sibling service's concrete Infrastructure project or on any Api host. A layering inversion like the one removed from `Realtime.Domain` now fails the build instead of passing review.
- Follow-up done in this audit pass: the shared messaging contracts have been relocated from `BuildingBlocks.Infrastructure.Messaging` to `BuildingBlocks.Application.Messaging` (see the next subsection).
- Remaining follow-up: `ICurrentUserContext` and `BusinessEventLogger` still live in `BuildingBlocks.Infrastructure`. Application handlers depend on `Infrastructure.Context`, which is why `BuildingBlocks.Infrastructure` itself is not yet in the Application architecture rule's forbidden list.

### Domain event dispatcher converged on a single implementation (2026-05-22)

- Removed the duplicate `Planora.BuildingBlocks.Infrastructure.IDomainEventDispatcher` interface and its MediatR-based implementation. The only dispatcher in the codebase is now `Planora.BuildingBlocks.Application.Messaging.IDomainEventDispatcher`, implemented by `Planora.BuildingBlocks.Infrastructure.Messaging.DomainEventDispatcher` (reflection-based: scans every registered `IDomainEventHandler<TEvent>`).
- Rewrote `CategoryDeletedDomainEventHandler` from `INotificationHandler<DomainEventNotification<…>>` to `IDomainEventHandler<CategoryDeletedDomainEvent>`. `Category.Application.DependencyInjection` now registers it explicitly under the new interface; `DomainEventNotification<T>` (no longer used) was deleted.
- `CategoryDbContext` and the design-time `CategoryDbContextFactory` now import the Application-layer dispatcher interface; the design-time stub implements both `DispatchAsync` overloads. The fully-qualified `: Planora.BuildingBlocks.Application.Messaging.IDomainEventDispatcher` workaround on `Infrastructure.Messaging.DomainEventDispatcher` was removed — the type now resolves cleanly via global usings.
- BB.Infrastructure DI keeps a single dispatcher registration; tests that mocked the old root interface (`DependencyInjectionContractTests`, `EfModelConfigurationTests`) were repointed to the Application interface.
- Build is warning-clean under `-warnaserror`; all 723 backend tests pass.

### Application layer fully isolated from Infrastructure (2026-05-22)

- `ICurrentUserContext`, `ICurrentUserService`, `IOutboxRepository`, `IOutboxProcessor`, `OutboxMessage`, `OutboxMessageStatus` and `DomainEventNotification<T>` were all relocated from `Planora.BuildingBlocks.Infrastructure.*` to the corresponding `Planora.BuildingBlocks.Application.*` namespaces (`Context`, `Persistence`, `Outbox`, `Messaging`). Implementations (`CurrentUserContext`, `CurrentUserService`, `OutboxProcessor`, `DomainEventDispatcher` and the per-service `OutboxRepository`) stay in Infrastructure.
- Removed the `services.AddScoped<IBusinessEventLogger, BusinessEventLogger>()` registration that each of the four service `Application/DependencyInjection.cs` files held: the Application layer no longer needs to know about the Serilog-based Infrastructure implementation. It is now registered once in `AddBuildingBlocksInfrastructure`.
- The Application-layer architecture rule is now the strict form: `Planora.BuildingBlocks.Infrastructure` is in the forbidden-namespace list alongside every service-specific `*.Infrastructure` and `*.Api`. No `*.Application` project depends on any Infrastructure or Api namespace; nothing slips through review.
- Build is warning-clean under `-warnaserror`; all 723 backend tests pass; markdownlint, frontend lint/type-check/test/build and the existing architecture suite stay green.

### Messaging contracts moved to the Application layer (2026-05-22)

- `IEventBus`, `IIntegrationEventHandler<T>`, `IntegrationEvent`, `IDomainEventDispatcher`, `IDomainEventHandler<T>` and the eight `*IntegrationEvent` types were moved from `Planora.BuildingBlocks.Infrastructure.Messaging` to `Planora.BuildingBlocks.Application.Messaging` (and `.Events`). Application handlers and consumers no longer cross the layering boundary just to publish or consume integration events.
- The RabbitMQ implementations (`RabbitMqEventBus`, `RabbitMqConnectionManager`, `IRabbitMqConnectionManager`) and `DomainEventDispatcher` stay in `BuildingBlocks.Infrastructure.Messaging`. `DomainEventDispatcher` now explicitly inherits from `Planora.BuildingBlocks.Application.Messaging.IDomainEventDispatcher` (fully qualified) because a pre-existing duplicate interface in the parent `BuildingBlocks.Infrastructure` namespace would otherwise win C# name resolution.
- Cross-cutting concern: the duplicate `Planora.BuildingBlocks.Infrastructure.IDomainEventDispatcher`/`DomainEventDispatcher` pair (MediatR-based) used only by `CategoryDbContext` is recorded as separate technical debt — converging on one dispatch mechanism is a future change.
- Global usings, `using` directives across 35+ files, `docs/overview.md` and `docs/architecture.md` updated. Build is warning-clean under `-warnaserror`; all 723 backend tests pass.

### Security — Phase 3 audit fixes (2026-05-22)

- **High — `IsDevelopmentEnvironment()` not testable via configuration**: `RequireHttpsMetadata` was gated solely on `ASPNETCORE_ENVIRONMENT`, which is not injectable in unit tests. `IsDevelopmentEnvironment()` now first checks `IConfiguration["IsDevelopment"]` (an explicit bool override used in tests and Docker overrides) before falling back to the env var. DI contract tests now pass the key as `"true"` without touching the environment (`Services/AuthApi/Planora.Auth.Infrastructure/DependencyInjection.cs`).
- **High — JWT ClockSkew corrected to zero**: ClockSkew was documented and asserted as `TimeSpan.Zero` across shared `JwtAuthenticationExtensions`, but AuthApi's `AddJwtAuthentication` still set it to 30 seconds. Corrected to `TimeSpan.Zero`; DI contract test assertion updated to match (`Services/AuthApi/Planora.Auth.Infrastructure/DependencyInjection.cs`).
- **High — `ChangeEmailCommandHandler` missing `ISecurityStampService` injection**: The security-stamp rotation added in Phase 2 was wired to the handler constructor but the handler unit test factory was never updated, causing a build error. Test factory updated to inject `Mock.Of<ISecurityStampService>()` (`tests/Planora.UnitTests/Services/AuthApi/Users/Handlers/UserSecurityHandlerTests.cs`).
- **High — `AddCommentCommandHandler` missing friendship gate**: Public-task comments were accessible to any authenticated user regardless of friendship. `AddCommentCommandHandler` now injects `IFriendshipService` and throws `ForbiddenException` when the commenter is neither the owner, a worker, nor a friend of the owner. Worker tests updated to set up `AreFriendsAsync = true`; a new `AddComment_ByNonFriendWithPublicAccess_ShouldThrowForbidden` test asserts the gate (`Services/TodoApi/Planora.Todo.Application/Features/Todos/Commands/AddComment/`, `tests/Planora.UnitTests/Services/TodoApi/Handlers/WorkersAndCommentsHandlerTests.cs`).
- **Medium — `BaseRepository.GetByIdAsync` using `FindAsync` (cross-scope lookup failure)**: `FindAsync` short-circuits through EF Core's identity map and returns `null` for entities saved by a different `DbContext` scope — a systematic bug that caused 404/500 responses on delete and update after create in integration tests. Replaced with `FirstOrDefaultAsync(e => e.Id == guidId)` which always queries the store, working correctly with all providers (`BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Persistence/BaseRepository.cs`).
- **Medium — `SoftDeleteByTodoIdAsync` used `ExecuteUpdateAsync` (InMemory incompatible)**: EF Core's InMemory provider does not support `ExecuteUpdateAsync`/`ExecuteDeleteAsync` bulk operations, causing `DeleteTodo` integration tests to return HTTP 500. Replaced with load-then-`MarkAsDeleted` pattern: loads all active comments for the todo and calls `comment.MarkAsDeleted(deletedBy)` on each, relying on the caller's `UnitOfWork.SaveChangesAsync()` to flush. Comment counts per todo are bounded, so the extra round-trip is negligible (`Services/TodoApi/Planora.Todo.Infrastructure/Persistence/Repositories/TodoCommentRepository.cs`).
- **Fix — `UnhandledExceptionBehavior` removed from MediatR pipeline**: DI contract test was asserting that `UnhandledExceptionBehavior` IS registered; it is intentionally NOT registered (global exception middleware handles unhandled errors). Test assertion changed from `Assert.Contains` to `Assert.DoesNotContain` (`tests/Planora.UnitTests/Services/Infrastructure/DependencyInjectionContractTests.cs`).

### Security — Phase 2 audit fixes

- **Critical — CSP nonce never applied**: the per-request CSP nonce was sent in the response header, but Next.js never received it (CSP was not on the request headers) and every route was statically prerendered, so the strict `script-src` blocked the framework's own inline scripts. The middleware now forwards the CSP on the request headers and the root layout opts every route into dynamic rendering, so Next.js stamps the matching nonce on all inline scripts (`frontend/src/middleware.ts`, `frontend/src/app/layout.tsx`).
- **High — CreateTodo owner spoofing**: `TodosController.CreateTodo` bound `CreateTodoCommand.UserId` from the request body, letting any authenticated user create todos owned by another account. The controller now nulls the field so the owner is always the JWT subject, matching `CategoriesController`/`MessagesController` (`Services/TodoApi/Planora.Todo.Api/Controllers/TodosController.cs`).
- **High — gRPC service-key auth incomplete**: only AuthApi validated the `x-service-key`. `ServiceKeyServerInterceptor` is now registered on the Todo, Category, Messaging, and Realtime gRPC servers as well; both interceptors reject keys shorter than 16 characters at startup (`Services/*/Program.cs`, `BuildingBlocks/.../Grpc/ServiceKey*Interceptor.cs`).
- **High — Data Protection key ring not persisted**: encrypted TOTP secrets became undecryptable after a container restart because the key ring was container-ephemeral. The key ring is now persisted to Redis under `Planora:Auth:DataProtection-Keys` (`Services/AuthApi/.../DependencyInjection.cs`).
- **High — access-token revocation only on AuthApi**: the password-change security stamp was checked only by AuthApi. A shared `SecurityStampValidator` is now invoked from the `OnTokenValidated` hook of every JWT-consuming service (Todo, Category, Messaging, Realtime), so a stolen token is rejected service-wide after a password change (`BuildingBlocks/.../Security/SecurityStampValidator.cs`).
- **Medium — JWT signing-key length not enforced**: the live AuthApi and shared consumer JWT paths now reject a `JwtSettings:Secret` shorter than 32 characters (`Services/AuthApi/.../DependencyInjection.cs`, `BuildingBlocks/.../Extensions/JwtAuthenticationExtensions.cs`, `Planora.ApiGateway/Program.cs`).
- **Medium — API Gateway gRPC clients missing service-key interceptor**: `Planora.ApiGateway` registered five gRPC clients without `ServiceKeyClientInterceptor`, so any call through them would be rejected by the downstream `ServiceKeyServerInterceptor`. `ServiceKeyClientInterceptor` is now registered as a singleton and wired into all five clients via `AddInterceptor<ServiceKeyClientInterceptor>()` (`Planora.ApiGateway/Extensions/ServiceCollectionExtensions.cs`). Note: the gateway currently routes exclusively via Ocelot HTTP and does not inject any of these clients; the fix is defensive.
- **Config**: `GRPC_SERVICE_KEY` is now passed to `realtime-api` in `docker-compose.yml` and documented in `.env.production.example`.
- **Tests**: added unit tests for `SecurityStampValidator` (revocation, claim parsing, fail-open), the gRPC `ServiceKey*Interceptor` pair (key validation, request rejection, and client header injection), and the `CreateTodo` owner-spoofing fix.

### Security — Phase 1 audit fixes

- **Critical — TOTP replay protection**: `TwoFactorService` previously discarded the `out long timeStepMatched` parameter, making it impossible to detect replay attacks within a 5-step window. Rewritten to capture the matched time-step and atomically record it in Redis (`SETNX totp:used:{userId}:{step}`, TTL=3 min). Service fails closed when Redis is unavailable. Interface updated to async `VerifyCodeAsync(string, string, Guid, CancellationToken)` (`Services/AuthApi/Planora.Auth.Infrastructure/Services/Authentication/TwoFactorService.cs`).
- **Critical — IDOR on `/friend-ids` and `/are-friends`**: Endpoints accepted any `userId` path parameter without comparing it to the caller's JWT `sub` claim. Added explicit ownership check; returns HTTP 403 on mismatch (`Services/AuthApi/Planora.Auth.Api/Controllers/FriendshipsController.cs`).
- **Critical — Soft-delete filter gap in TodoRepository**: Five query methods were missing `!t.IsDeleted`, exposing soft-deleted todos. Added filter to all five; `GetByUserId` intentionally unchanged (used by deletion cleanup consumer) (`Services/TodoApi/Planora.Todo.Infrastructure/Persistence/Repositories/TodoRepository.cs`).
- **High — Cookie `Secure` flag behind reverse proxy**: `AuthenticationController` used `Secure = HttpContext.Request.IsHttps` on all five cookie paths. Behind a TLS-terminating proxy this evaluates to `false`. Replaced with `SecureCookie = !_env.IsDevelopment()` via `IWebHostEnvironment` (`Services/AuthApi/Planora.Auth.Api/Controllers/AuthenticationController.cs`).
- **High — Revoked friends retained shared-todo access**: Friendship removal never cleaned up `TodoItemShare` rows, so ex-friends could still comment on shared todos. Added `FriendshipRemovedIntegrationEvent` published from `RemoveFriendCommandHandler`; new `FriendshipRemovedEventConsumer` in TodoApi removes stale share rows in both directions (`BuildingBlocks/…/Events/FriendshipRemovedIntegrationEvent.cs`, `Services/TodoApi/…/FriendshipRemovedEventConsumer.cs`).
- **High — JWT ClockSkew mismatch**: Auth service used 5-minute clock skew vs. 30 seconds in shared extension. Corrected to 30 seconds (`Services/AuthApi/Planora.Auth.Infrastructure/DependencyInjection.cs`).
- **High — `IsDevelopment` from freeform config key**: `RequireHttpsMetadata` was gated on a config key that could be set by accident. Changed to read `ASPNETCORE_ENVIRONMENT` directly.
- **High — Notification type injection**: `SendNotification` accepted arbitrary strings as notification type, allowing injection into connected SignalR sessions. Added static `AllowedNotificationTypes` allowlist; unknown types → HTTP 400 (`Services/RealtimeApi/Planora.Realtime.Api/Controllers/NotificationsController.cs`).
- **High — Next.js `serverActions.allowedOrigins` misconfiguration**: Both branches of the ternary evaluated to `[]`. Fixed so `localhost:3000` is only allowed in development (`frontend/next.config.js`).
- **Medium — PII in application logs**: Email addresses removed from INFO/WARNING log messages across `AuthenticationController`, `LoginCommandHandler`, and `RegisterCommandHandler`; one duplicate-email warning retains only the email domain.
- **Medium — `isAuthenticated` persisted to sessionStorage**: After page reload, rehydration restored `isAuthenticated: true` with no `accessToken`, creating a false-positive window before `restoreSession()` ran. Removed from `partialize`; flag now starts `false` on rehydration (`frontend/src/store/auth.ts`).

### Known security limitations (tracked, not yet fixed)

- **Medium — `style-src 'unsafe-inline'` in production CSP**: `script-src` is now nonce-based, but `style-src` still allows `'unsafe-inline'` because Tailwind and Next.js inject critical CSS as inline `<style>` tags during SSR (`frontend/src/middleware.ts`). Removing it requires nonce/hash support for inline styles.
- **Medium — token blacklist/security-stamp checks fail open on Redis outage**: `TokenBlacklistFilter` and `SecurityStampValidator` return "not revoked" if Redis is unavailable, trading strict revocation for availability. Documented trade-off.
- **Low — gateway gRPC clients unused**: `Planora.ApiGateway` registers five gRPC clients (and `AuthGrpcClient`) that are not currently injected anywhere; the gateway routes requests via Ocelot HTTP. Clients now carry `ServiceKeyClientInterceptor` (see Phase 2 fixes above) so they are ready if active use is added.

### Security — prior fixes

- Fixed: `GlobalLimiter` was commented out in `AddConfiguredRateLimiting()`, leaving all data endpoints without rate limiting. Replaced with a working `PartitionedRateLimiter` (100 req/min per IP) so every service has a baseline cap without requiring per-controller annotations (`BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Extensions/ServiceCollectionExtensions.cs`).
- Fixed: `NotificationHub.Subscribe()` accepted any arbitrary group string, allowing a user to subscribe to channels of other users. Added a static `AllowedTopics` whitelist `{system, announcements, todos}`; requests for other topics are rejected with a warning log (`Services/RealtimeApi/Planora.Realtime.Infrastructure/Hubs/NotificationHub.cs`).
- Fixed: All 6 service `Program.cs` files contained copy-pasted inline lambdas setting weaker `style-src 'unsafe-inline'` CSP headers. Added `UseSecurityHeaders()` extension method to `SecurityHeadersMiddleware` and replaced all inline lambdas with the single shared, stricter implementation.

### CI / CD

- `dotnet build` now passes `-warnaserror` flag; warnings are treated as errors in Release builds (`.github/workflows/ci.yml`).
- Frontend CI switched from `rm -f package-lock.json && npm install` to `npm ci` with correct `cache-dependency-path: frontend/package-lock.json` for reproducible installs (`.github/workflows/ci.yml`, `.github/workflows/e2e.yml`).
- E2E workflow gained `permissions: contents: read` and `concurrency` group with `cancel-in-progress: true` (`.github/workflows/e2e.yml`).
- Added `permissions: contents: read` (minimum principle) and `security-events: write` to GitHub Actions workflows.
- Added `concurrency` groups to cancel duplicate in-progress runs on the same branch.
- Added `timeout-minutes` to every CI job (10 min docs/security, 15 min frontend, 20 min backend).
- Extended push triggers to include `claude/**` branches.
- Added `github-actions` ecosystem to Dependabot so action version references are kept up to date automatically (`.github/dependabot.yml`).

### Tests

- Vitest coverage thresholds enforced: lines/functions/statements ≥ 85 %, branches ≥ 80 % — CI now fails if coverage drops below these baselines (`frontend/vitest.config.ts`).
- Added `frontend/src/test/components/worker-and-comments.test.tsx` with 36 tests covering `WorkerJoinButton` (all 4 render states, pending/debounce, hover callbacks) and `TaskComments` (load/empty/render, add/edit/delete CRUD, keyboard shortcuts, time-display branches, pagination). Frontend branch coverage: 81.88% → 85.11%.

## [1.0.0] — 2026-05-10

### Highlights

First public release of Planora — a .NET 9 microservice backend with a Next.js 15 frontend for personal productivity management.

## [0.1.0] — 2026-04-24

### Frontend — Visual Design

- Added `TopologyBackground` canvas component (`frontend/src/components/backgrounds/topology-background.tsx`): animated off-white marching-squares contour field applied globally to every page via the root layout.
  - Scalar field built from three overlapping sine/cosine waves; 9 contour levels rendered with a single `beginPath/stroke` per level for efficiency.
  - Cursor ripple distortion via passive `pointermove` listener on `window`; click ripple rings via `pointerdown`.
  - Ambient blobs (warm + cool radial gradients) pre-rendered once into an offscreen `HTMLCanvasElement` and blitted per frame.
  - DPR-aware canvas resize: pixel ratio capped at ×2, `alpha: false` context, `setTransform` scale — saves ~15–20 % render time on hi-DPI screens.
  - Adaptive grid: 32/42/52/60 cells depending on viewport width; FPS watchdog auto-lowers grid by 10 if average drops below 40 fps over the first 60 frames.
  - Pauses automatically on hidden tab (`visibilitychange`), offscreen canvas (`IntersectionObserver`), and `prefers-reduced-motion: reduce` (single static frame).
  - `aria-hidden="true"`, `pointer-events-none`, `fixed inset-0 -z-10` — purely decorative, never intercepts clicks.
- Added `TopologyLayer` client wrapper (`frontend/src/components/backgrounds/topology-layer.tsx`) — a `lazy`-loaded `Suspense` boundary imported once in the root layout.
- Extended `PageBackground` with optional `variant?: "static" | "topology"` prop for opt-in per-component use.
- Updated root layout body background from `bg-white` to `bg-[#f8f7f4]` (matches canvas base color — eliminates FOUC flash).
- Refreshed landing page copy: updated hero headline, subheading, badge text, feature card descriptions, and footer line.
- Landing page feature cards and nav updated with glass morphism tokens (`bg-white/50 backdrop-blur-sm`, `border-white/60`) for visual coherence with the animated canvas beneath them.

### Documentation

- Rebuilt the documentation structure around a central docs index.
- Added detailed guides for overview, getting started, configuration, architecture, codebase map, features, API, database, security, testing, deployment, development, troubleshooting, FAQ, and glossary.
- Clarified confirmed behavior around Next.js 15, httpOnly refresh cookies, CSRF, hidden shared todo redaction, gateway routes, database ownership, and local Docker/startup configuration.
- Added production deployment baseline, secret management guide, and production environment template.
- Added a public security disclosure policy that uses GitHub Private Vulnerability Reporting.

### CI / QA

- Added markdownlint and offline Markdown link checks to CI.
- Added Docker-backed Playwright e2e coverage for auth, email verification, friendship, shared todos, and hidden viewer preference behavior.
- Excluded generated Playwright e2e specs from Vitest unit-test discovery.

### Repository Hygiene

- Added repository rules for documentation synchronization after behavior/config/test changes.
- Ignored AI/agent-local state, generated build artifacts, `tsconfig.tsbuildinfo`, and generated EF `Migrations/` folders.
- Expanded repository hygiene ignores for nested assistant/tooling state, MCP config, local assistant prompts, and generated chat/history artifacts.
- Removed tracked Claude local settings, Obsidian workspace/plugin state, frontend build output, frontend TypeScript build info, and generated EF migration files.
- Hardened `.dockerignore` so local agent/editor state, tests, docs, build artifacts, and generated migrations stay out of Docker build contexts.
- Bound RabbitMQ AMQP to `127.0.0.1:5672` in local Compose and added a runtime contract assertion for the localhost binding.
- Replaced a JWT-shaped test fixture with a non-token invalid bearer value to reduce false positives in secret scanners.
- Added database startup fallback that creates schema from the current EF model when no user-owned migrations exist.

### Project Metadata

- Added MIT license.

[1.0.0]: https://github.com/4Keyy/Planora/releases/tag/v1.0.0
[0.1.0]: https://github.com/4Keyy/Planora/releases/tag/v0.1.0
