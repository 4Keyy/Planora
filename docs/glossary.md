# Glossary

Every term this project uses with a specific meaning, in one alphabetical list. A word is
here because reading the code without it is harder than it should be, or because two words
were once used for one thing and somebody had to guess whether the difference mattered.

The last section is the other half of that job: the words the product is **not** allowed to
use. A glossary that never says what not to call something leaves the synonym in place.

## Terms

| Term | Meaning | Where used |
|---|---|---|
| Access token | Short-lived JWT sent in `Authorization: Bearer` headers, held in frontend memory only (INV-AUTH-1) | `AuthenticationController.cs`, `frontend/src/store/auth.ts` |
| ADR | Architecture Decision Record — closed-form record of a decision and its rejected alternatives | `docs/DECISIONS/000*.md` |
| API Gateway | Ocelot ingress service that maps public routes to backend services. The only HTTP entry point into the system | `Planora.ApiGateway` |
| Arrival | A presence id that was not in the previous distinct set of ids, ringed once when its face appears. A first mount is deliberately not an arrival: a page load would otherwise ring every participant at once and teach the reader that the ring means nothing | `usePresenceArrivals` in `frontend/src/components/ui/presence-row.tsx` |
| Audience | Who can see a task: `private`, `shared` with named friends, or `public`. The product's one word for reach — see the forbidden-synonym table below | `RedactionBadge`, `TodoItem.IsPublic` / `SharedWithUserIds` |
| Auth API | Service that owns identity, sessions, friendships, roles, analytics intake | `Services/AuthApi` |
| Branch | A task together with its timeline of messages, replies and subtasks — the task's own screen, opened as a modal from a card or on its own URL at `/branch/[id]` | `frontend/src/app/branch/[id]/page.tsx`, `edit-todo-modal/branch-feed.tsx` |
| BuildingBlocks | Shared kernel — domain primitives, CQRS abstractions, Result type, middleware, observability pipeline, outbox/inbox, gRPC interceptors | `BuildingBlocks/Planora.BuildingBlocks.*` |
| Capture | Creating a task from a title and nothing else. Priority, due date, category and audience are deliberately absent: a decision at the moment of capture is why a thought stops being written down at all | `frontend/src/components/todos/quick-capture.tsx` |
| Category | User-owned label for tasks with colour, icon and order | `Services/CategoryApi` |
| Category gRPC | Internal service contract used to validate and enrich a task's category | `GrpcContracts/Protos/category.proto` |
| CD pipeline | Tag-driven Fly.io blue/green deployment workflow | `.github/workflows/cd.yml` |
| CheckTaskCommentAccess | Todo gRPC call returning task existence, comment access, owner and participants. It is how Collaboration authorises a comment without reading Todo's database | `GrpcContracts/Protos/todo.proto`, `TodoGrpcService.cs` |
| Circle | The people a user shares with — their accepted friendships | `Friendship.cs`, `frontend/src/hooks/use-friends.ts` |
| Collaboration API | Service that owns the task comment timeline and comment notifications; authorises every operation against Todo via gRPC | `Services/CollaborationApi` |
| `@colour-data` | Marker comment on the five source files where a colour literal is data rather than theme — category swatches, default category colours, per-notification tints, WCAG luminance constants, the HSL wheel's primaries. The contract test keys off the marker, so the exemption sits beside the values instead of in a list somewhere else | `edit-todo-modal/utils.ts`, `edit-todo-modal/color-picker.tsx`, `lib/icon-map.ts`, `lib/utils.ts`, `lib/notifications/types.ts` |
| Command palette | The ⌘K / Ctrl+K surface: one chord, three letters, Enter. The desktop keyboard path that used to stop at Tab | `frontend/src/components/command-palette.tsx` |
| Comment timeline | Per-task chronological thread of user, genesis and system comments | `Services/CollaborationApi/.../Comment.cs` |
| ConfigurationValidator | Startup-time check that rejects weak JWT secrets and missing gRPC keys before the host binds a port | `BuildingBlocks/.../Configuration/ConfigurationValidator.cs` |
| Cosign | Sigstore tool for keyless artifact signing; used by the SBOM attestation step in CI | `.github/workflows/security.yml` |
| CQRS | Command/query separation through MediatR handlers | `*.Application/Features` |
| CSP nonce | Per-request random value minted in `middleware.ts` and forwarded as `x-nonce` so Server Components can attach it to their inline scripts. It is the reason the whole App Router is `force-dynamic` | `frontend/src/middleware.ts`, `docs/DECISIONS/0006-force-dynamic-and-csp-nonce.md` |
| CSRF double-submit | The protection named by INV-AUTH-3: Auth API sets a readable `XSRF-TOKEN` cookie, the frontend echoes it in `X-CSRF-Token`, and the middleware compares the two in constant time | `CsrfProtectionMiddleware.cs`, `frontend/src/lib/csrf.ts` |
| Cursor | The single highlighted row of a keyboard-navigable list, held as an **id** and never as an index — completing a task, changing a filter and a realtime reconcile each replace the array, and an index would then point at a different task. Carried on the row as `aria-current="true"` plus `data-active` | `frontend/src/hooks/use-list-navigation.ts` |
| CycloneDX SBOM | Software Bill of Materials artifact emitted per build, listing every NuGet and npm dependency | `.github/workflows/security.yml` `sbom` job |
| Dependabot | Automated dependency-update PRs for npm, nuget, github-actions, docker ecosystems | `.github/dependabot.yml` |
| Duration tokens | The five motion durations, by name: `instant` 100ms, `fast` 160ms, `base` 220ms (the default), `slow` 320ms (the UI ceiling), `deliberate` 480ms. `deliberate` is non-UI only — a number roller or a progress ring reports a fact; it does not answer a press | `frontend/src/lib/design-tokens.ts`, re-exported as `DURATION_*` from `lib/animations.ts` |
| Error budget | Allowed shortfall implied by an SLO; burning it pauses feature work in favour of reliability | [`docs/slo.md`](slo.md) |
| Eyebrow label | The one uppercase micro-label style, exported as `FIELD_LABEL_CLASS`. It uses `ink-muted` rather than `ink-subtle` because 12px uppercase is the hardest combination to read and belongs clear of the floor | `frontend/src/components/ui/field.tsx` |
| Fly.io | Chosen production hosting target | `deploy/fly/`, `.github/workflows/cd.yml` |
| `fly.toml` | Per-app Fly.io manifest declaring build context, env, health probes, concurrency, VM size | `deploy/fly/*.fly.toml` |
| FLY_API_TOKEN | GitHub repository secret authenticating `flyctl` in the CD workflow | `.github/workflows/cd.yml` |
| Focus indicator | The single focus ring, declared once through a zero-specificity `:where()` selector so a component can add to it and nothing can take it away. `outline-none` compiles to a transparent outline, which is why it is forbidden | `frontend/src/app/globals.css` |
| `force-dynamic` | The route-segment config declared once in `app/layout.tsx` and cascading to every route. A statically rendered page would serve a cached CSP nonce, which is the same as having no nonce | `frontend/src/app/layout.tsx`, ADR-0006 |
| Friend request | Pending friendship relation between requester and addressee | `FriendshipsController.cs` |
| Friendship | Accepted social relation. It gates task sharing and, through INV-AZ-4, the comment timeline | `Friendship.cs`, `auth.proto` |
| Genesis comment | The task's initial description rendered as the first timeline entry; a system comment owned by the task owner, one per task | `Comment.CreateGenesis` |
| Grafana Cloud OTLP | Managed OTLP endpoint for traces and metrics; enabled by setting `OTEL_EXPORTER_OTLP_ENDPOINT` per app | [`docs/observability.md`](observability.md) |
| Grafana Loki | Log aggregation backend; enabled by setting `LOKI_URL` per app | `SerilogConfiguration.TryAddLokiSink` |
| Hidden | A task collapsed out of one reader's own list without changing the owner's task. Not the same as `private`: hidden is about one viewer's list, private is about who was ever given access | `TodoItem.Hidden`, `UserTodoViewPreference` |
| Hidden redaction | See **Redaction** | same |
| Inbox | Integration event deduplication and receipt table pattern | `BuildingBlocks/.../Inbox` |
| Ink | The text-and-marks colour ramp: `ink` 17.93:1, `ink-muted` 7.81:1, `ink-subtle` 4.74:1 (the floor for body copy), `ink-faint` 2.52:1. `ink-faint` is non-text only — `text-ink-faint` is never correct, and `gray-400` is the same value wearing a different name | `frontend/src/lib/design-tokens.ts` |
| INV-AUTH-1 | Access tokens live only in frontend memory. Never `localStorage`, `sessionStorage`, or any cookie | [`docs/INVARIANTS.md`](INVARIANTS.md), `frontend/src/store/auth.ts` |
| INV-AUTH-2 | Refresh tokens live only in an httpOnly, `SameSite=Strict` cookie scoped to `/auth/api/v1/auth`. The frontend cannot read them and they are never returned in a response body | [`docs/INVARIANTS.md`](INVARIANTS.md), `AuthenticationController.cs` |
| INV-AUTH-3 | State-changing browser requests to Auth API carry the double-submit CSRF token, validated in constant time | [`docs/INVARIANTS.md`](INVARIANTS.md), `CsrfProtectionMiddleware.cs` |
| INV-AZ-3 | Hidden shared and public tasks are redacted server-side. The frontend never receives sensitive content for a hidden task; only the non-content visual fields `Priority`, `IsPublic`, `HasSharedAudience` and `IsVisuallyUrgent` survive, so the collapsed card can keep its frame after a reload | [`docs/INVARIANTS.md`](INVARIANTS.md), `HiddenTodoDtoFactory.cs` |
| INV-XYZ-N | Closed-form architectural invariant identifier | [`docs/INVARIANTS.md`](INVARIANTS.md) |
| JWT | JSON Web Token used as the access token. The client only decodes it; verification is the gateway's and each service's job | `JwtAuthenticationExtensions.cs`, `frontend/src/lib/jwt.ts` |
| k6 | JavaScript load-test scenario runner | `perf/k6/`, `.github/workflows/perf-smoke.yml` |
| Layer tiers | The eight named z-index tiers — `base` 0, `dropdown` 1000, `sticky` 1100, `overlay` 1200, `modal` 1300, `popover` 1400, `toast` 1500, `tooltip` 1600. `toast` sits above `modal` on purpose: a message hidden behind the dialog that raised it is a message nobody receives. A single-digit local `zIndex` inside one component is ordinary CSS; ten and above is a claim about the whole product and must come from the scale | `frontend/src/lib/design-tokens.ts` |
| Line | The border ramp: `line` 1.26:1 for decorative separation, `line-strong` 4.54:1 for anything a user is meant to aim at | `frontend/src/lib/design-tokens.ts` |
| NumberRoll | The digit roller. A counter that hard-swaps reads as a re-render; rolling the digits makes the direction of change legible without a label | `frontend/src/components/ui/number-roll.tsx` |
| Ocelot | .NET API Gateway library used for route mapping | `Planora.ApiGateway/ocelot*.json` |
| OpenTelemetry (OTel) | Cross-cutting traces and metrics pipeline registered via `AddPlanoraTelemetry` | `BuildingBlocks/.../Logging/TelemetryConfiguration.cs` |
| OTLP | OpenTelemetry Protocol — gRPC transport for traces and metrics; the exporter registers only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set | same |
| Outbox | Integration event persistence pattern: the event row is written in the same transaction as the state change, then published | `BuildingBlocks/.../Outbox`, `Planora.Todo.Application/Common/OutboxExtensions.cs` |
| PagedResult | Shared pagination response type | `BuildingBlocks/.../Pagination/PagedResult.cs` |
| Paper | The surface ramp, plus its reverse for the dark auth panel: `paper`, `paper-sunken`, `paper-raised`, and `paper-muted` / `paper-subtle` for text **on** ink. They exist as their own tokens because `ink-muted` on `#171717` measured 2.29:1 | `frontend/src/lib/design-tokens.ts` |
| Per-viewer completion | A non-owner marking a shared or public task done writes only `UserTodoViewPreference.CompletedByViewer`; the owner's task is untouched. Reopening is author-only — a viewer's way forward on a done task is Duplicate | `SetViewerPreferenceCommandHandler.cs` |
| Planora.Migrator | One-shot CLI applying pending EF Core migrations before each service rollout | `tools/Planora.Migrator/` |
| PlanoraMetrics | Shared `Meter("Planora.BuildingBlocks")` publishing CSRF, gRPC and outbox instruments | `BuildingBlocks/.../Observability/PlanoraMetrics.cs` |
| Playwright e2e | Docker-backed tests: one API spec covering auth, sharing and the hidden flow through the gateway, plus UI specs for the auth routes, profile and the tasks page | `frontend/e2e`, `.github/workflows/e2e.yml` |
| Presence | Who is inside a task right now, drawn as overlapping faces rather than a count. "3 participants" answers how many, which is the one question nobody arrives with; the questions are who, and did someone just join | `frontend/src/components/ui/presence-row.tsx` |
| Priority meter | Priority as a five-segment meter in one ink colour. Five hues collapse under deuteranopia — the two lowest measured 0.049 apart in OKLab, below the just-noticeable threshold — so the scale is length, not colour | `frontend/src/components/ui/priority-meter.tsx` |
| Private | The audience where nobody but the owner has access. Drawn as a ring with one narrow cut and a filled centre dot; the dot is what separates it from `public` at the 14px size | `RedactionBadge`, `TodoItem.IsPublic == false` with an empty shared list |
| Production baseline | Documented deployment checklist and runtime assumptions, not an automated deploy target | `docs/production.md` |
| Public | The audience open to every authenticated user. Drawn as a closed ring | `TodoItem.IsPublic`, `GetPublicTodosQueryHandler` |
| Rate-limit partition key | `u:<sub>` for authenticated requests, `ip:<address>` for anonymous, so users behind one NAT do not share a bucket | `ServiceCollectionExtensions.PartitionKey` |
| RED metrics | Rate / Errors / Duration — the three signals captured by ASP.NET Core OTel instrumentation | [`docs/observability.md`](observability.md) |
| Redaction | Server-side masking of a hidden shared or public task's content before the DTO leaves TodoApi. It is the security boundary, so hiding something in the UI never is | `HiddenTodoDtoFactory.cs`, `frontend/src/components/ui/redaction-badge.tsx` |
| Refresh token | Long-lived server-side token delivered as an httpOnly cookie, rotated on every use with reuse detection (INV-AUTH-6) | `RefreshToken.cs`, `AuthenticationController.cs` |
| Result | Shared success/failure return model | `BuildingBlocks/Planora.BuildingBlocks.Domain/Result.cs` |
| Roving tabindex | Exactly one row of a list is in the tab order — the row under the cursor, or the first row before there is one. Tab enters the list once and the keys take over; a list where every row is `tabIndex={-1}` is unreachable by keyboard | `frontend/src/hooks/use-list-navigation.ts` |
| SBOM | See **CycloneDX SBOM** | same |
| Schema bootstrap | Startup path that applies EF migrations when present or creates the schema from the current EF model when they are absent | `DatabaseStartup.cs`, service `Program.cs` files |
| Secret store | Production location for sensitive values such as database passwords and the JWT secret | `docs/secrets-management.md`, `.env.production.example` |
| Security stamp | Per-user value in Redis, rotated by every command that materially changes an account's security posture; `TokenBlacklistFilter` checks it on each authorized request, so tokens minted before the rotation are rejected on their next call | `SecurityStampService.cs`, `TokenBlacklistFilter.cs`, INV-AUTH-4 |
| Selection | The set of rows gathered with `x`, `Shift+J/K`, `Shift+↑/↓` or `⌘A`, acted on only from the selection bar. No shortcut triggers a bulk action: a destructive keystroke over a set that scrolled out of view is not one anybody can take back | `use-list-navigation.ts`, `components/ui/selection-bar.tsx` |
| Shared | The audience where named friends have access. Drawn as a ring cut open from 16% of its circumference, widening 4.5% per viewer and saturating at 50% — past half the circumference the mark reads as a bracket rather than a ring | `RedactionBadge`, `TodoItemShare.cs` |
| Shared origin | The bounding rect of the card the user pressed, recorded on the press and consumed once, so the editor dialog grows out of that card instead of fading in from the centre. Consuming it means a dialog opened any other way — the palette, a notification, a deep link — falls back to the plain entrance rather than flying out of whatever card was pressed last | `frontend/src/lib/shared-origin.ts` |
| `SHORTCUT_GROUPS` | The exported single source of truth for every key the product answers to, grouped as Anywhere / The list / A branch. The `?` overlay renders it and the contract test pins it, so a hand-written second copy of a chord cannot drift | `frontend/src/components/ui/shortcuts-overlay.tsx` |
| SignalR | ASP.NET realtime transport used by Realtime API; one hub, mapped at `/hubs/notifications` | `Services/RealtimeApi` |
| SLI | Service Level Indicator — the concrete metric an SLO measures | [`docs/slo.md`](slo.md) |
| SLO | Service Level Objective — numeric target an SLI must satisfy over a rolling window | [`docs/slo.md`](slo.md) |
| Spring tokens | The three framer-motion springs: `SPRING_STANDARD` 400/28 for modals and cards, `SPRING_RESPONSIVE` 416/20 for chips and buttons, `SPRING_GENTLE` 260/24 for presence and decoration | `frontend/src/lib/animations.ts` |
| StatusPanel | The one shape every empty, loading and error panel takes. It has no slot for `error.message` — a raw server message can carry a stack trace or another user's data — and takes a `referenceId` instead | `frontend/src/components/ui/status-panel.tsx` |
| Stryker.NET | Mutation testing tool; runs on security-critical helpers | `stryker-config.json` and `stryker-auth.json` at the repo root, over `tests/` |
| Subtask | A child `TodoItem` with `ParentTodoId` set, one level deep, living only inside its parent's branch. Completion is global; taking one into work is per-user | `TodoItem.CreateSubtask`, `edit-todo-modal/branch-feed.tsx` |
| System comment | Auto-generated timeline entry for a task's lifecycle — created, completed, started, left — with no user author | `Comment.CreateSystem`, Collaboration Inbox consumers |
| Take | Joining a task or subtask as a worker. The owner never "takes" their own task — they participate implicitly | `worker-join-button.tsx`, `JoinTodoCommandHandler` |
| Task | The product's unit of work, stored as a `TodoItem`. The code still says `todo` in type names and routes for compatibility; user-facing text never does | `TodoItem.cs`, `frontend/src/types/todo.ts` |
| Todo share | Explicit row granting another user access to a task | `TodoItemShare.cs` |
| Todo status | Backend task lifecycle enum: `Todo`, `InProgress`, `Done`. The frontend's `TodoStatus` carries extra legacy aliases, which `toApiTodoStatus` normalises away before any write | `Planora.Todo.Domain/Enums/TodoStatus.cs`, `frontend/src/types/todo.ts` |
| Touch target | The 44×44 minimum, and the `.touch-target` utility that paints an invisible 44×44 hit area around a control that must stay visually small. Two things silently defeat it: inherited `pointer-events: none`, and `overflow: hidden` clipping the pseudo-element | `frontend/src/app/globals.css` |
| Trace context | W3C `traceparent` header carrying trace-id and span-id across the browser → backend boundary | `frontend/src/lib/trace.ts`, `AddPlanoraTelemetry` AspNetCore instrumentation |
| TryAddLokiSink | Helper that adds a Grafana Loki Serilog sink when `LOKI_URL` is configured, no-op otherwise | `BuildingBlocks/.../Logging/SerilogConfiguration.cs` |
| Undo window | The five seconds between a delete gesture and the `DELETE` request being sent; undo cancels the timer and nothing reaches the server. The API has no restore endpoint, so an optimistic delete offering "restore" would be a lie | `UNDO_WINDOW_MS` in `frontend/src/components/ui/undo-bar.tsx` |
| Update pill | Somebody else's change, offered rather than applied. `useDeferredUpdates` holds an arriving change unless the list is at the top and nothing is busy, because an insert above the viewport moves every row under a pointer that was already aimed at one | `frontend/src/components/ui/update-pill.tsx` |
| UserTodoViewPreference | Per-viewer hidden, category and completion state for a shared task | `UserTodoViewPreference.cs` |
| Verify-Phase1-Prereqs.ps1 | Read-only checker for flyctl auth, per-app secrets, build cleanliness, FLY_API_TOKEN | `scripts/Verify-Phase1-Prereqs.ps1` |
| Viewer | Anyone reading a task they do not own. Their hidden and completion state lives in `UserTodoViewPreference`, never on the task itself | `TodoViewerStateResolver.cs` |
| Worker | A user who has taken a task or subtask into work, stored as a `TodoItemWorker` row. The owner is never stored as one — `RequiredWorkers` counts them anyway, so `1` means owner-only and `null` means unlimited | `TodoItemWorker.cs`, `JoinTodo` / `LeaveTodo` handlers |
| XSRF-TOKEN | The readable CSRF cookie the frontend echoes in `X-CSRF-Token` | `AuthenticationController.GetCsrfToken` |

## One concept, one word

A synonym is not a stylistic choice. Two words for one concept make a reader wonder what
the difference is, and there is no answer. The right-hand column is what the interface must
never say; the same discipline applies to new code and new docs.

| Concept | The word | Never |
|---|---|---|
| A unit of work | **task** | todo, item, entry |
| A nested unit | **subtask** | child, sub-item |
| A task with its timeline | **branch** | thread, discussion, feed |
| The people you share with | **circle** | friends, team, members |
| Who can see a task | **audience** | visibility, sharing list |
| Hiding fields from part of the circle | **redaction** | hiding, privacy mode |
| Taking a task into work | **take** | claim, assign, start |

The backend's type names and routes still read `todo` — `TodoItem`, `/todos/api/v1/todos`,
`types/todo.ts`. That is a compatibility surface, not a second vocabulary: it stays where it
is, and nothing a user reads inherits it.

## See also

- [`INVARIANTS.md`](INVARIANTS.md) — the closed-form rules the `INV-*` entries above point at
- [`design-system.md`](design-system.md) — the colour, type, motion and layer vocabulary in full
- [`features.md`](features.md) — confirmed behaviour per feature
- [`frontend.md`](frontend.md) — the frontend's own conventions and the keyboard model
- [`codebase-map.md`](codebase-map.md) — where each of these files lives
