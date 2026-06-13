# Changelog

All notable changes to Planora are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### fix(ui): branch-page polish, smooth dropdowns, in-place title edit, custom calendar (2026-06-14)

A batch of branch-editor and dashboard UX fixes.

- **Branch page meta sidebar** widened ~25% (296 → 370px) so the controls fit, and the
  always-open due-date calendar now hides its quick-pick chips on the page (`DateCalendar`
  `hideQuickPicks`).
- **In-place title edit** no longer jumps: the title textarea is sized before paint
  (`useLayoutEffect`) so entering edit mode fades in place instead of flashing a 1-row field then
  growing. Applies to both the modal and the page.
- **Page edits now stick** — fixed the "controls snap back / flip between options" bug. The editor
  re-seeds its fields from the task only on task switch (`todo.id`), not on every fed-back update,
  so an autosave that returns `isPublic:false, sharedWith:[]` no longer flips visibility
  friends→private (and the same for every other control).
- **Smooth dropdowns** — the shared `Popover` (priority / due date / category / visibility) now
  animates open AND close via framer-motion (`AnimatePresence`, scale/fade/slide) instead of an
  enter-only CSS keyframe.
- **"New Task" button** no longer jerks sideways: fixed min-width + centred label, and the
  label crossfades (no rotate) so swapping New Task ⇄ Close stays put.
- **Custom calendar on the create panel** (dashboard + tasks): the native `<input type="date">`
  and quick chips are replaced by the project's own inline `DateCalendar`.
- **Quieter console** — background branch polling (`mergeLatest` / subtask refresh) is marked
  best-effort so a transient failure no longer logs `[API Error]` to the console; one-off loads
  still log.

### fix(frontend): clean LAN dev console — allowedDevOrigins + prod-only Cross-Origin headers (2026-06-13)

Addresses the console noise a teammate saw opening the LAN-shared dev server
(`http://<lan-ip>:3000`):

- **HMR websocket blocked.** Next 16 treats a teammate's LAN-IP origin as a cross-origin dev
  request and blocks the internal `/_next/*` resources (incl. `ws://…/_next/webpack-hmr`) unless
  the origin is allow-listed. `next.config.js` now auto-populates `allowedDevOrigins` (dev only)
  with the host's own non-internal IPv4 addresses, plus any `NEXT_DEV_ALLOWED_ORIGINS` env entries.
- **COOP "header ignored" warning.** `Cross-Origin-Opener-Policy` / `Cross-Origin-Resource-Policy`
  are now sent in **production only** (alongside HSTS). Browsers ignore them over plain HTTP (a LAN
  IP isn't a secure context) and log a warning; emitting them in dev added noise without protection.

(The "Download React DevTools" notice is inherent to React in dev and is gone in a production
build; functionality was never affected.)

### feat(branch): page meta sidebar + composer polish (2026-06-13)

- **Branch page two-column layout.** The standalone `/branch/{id}` page now puts the editable title
  on the header row next to the `Task Branch` label with the In Progress pill to its right, and
  moves the task controls into a compact **left meta sidebar** (`PageMetaPanel`) — priority,
  category and visibility as full-width rows, and the **due-date calendar always open** (extracted
  `DateCalendar` from `DatePopover`) so the previously-empty left space is a one-click date picker.
  The modal keeps its single-column layout.
- **Compose conventions unified.** In the branch composer, **Enter** now sends/adds in every mode
  (plain message, subtask, description); **Shift+Enter** inserts a newline. The same convention
  applies to editing a message and the Author's Note editor. Switching compose mode via "+" no
  longer wipes the typed draft.
- **Subtask inline-edit jump fixed.** Double-clicking a subtask title now edits in place — the
  view/edit elements share one box model, so the field fades in without the text jumping.

### feat(branch): full editor on the standalone branch page (2026-06-12)

Extracted the modal's editor body into a shared `TodoEditor` (exported from `modal.tsx`) so the
branch page is the **complete editor**, not a stripped view. `EditTodoModal` is now just the dialog
chrome around `<TodoEditor variant="modal">`; the `/branch/{id}` page renders
`<TodoEditor variant="page">` full-width.

- The page now has **every editing control** the modal has — inline title edit, priority, due date,
  category picker, visibility/sharing, owner autosave, the In Progress pill (hover → Leave) and the
  "+" menu — plus the full branch.
- The page is **full-width** with the same gutters as the rest of the app (`max-w-[1600px]`,
  `px-4/5/6`); it owns the task + category data and wires every action against the API (autosave
  preserves status, viewer category preference, take/leave, complete/restore, duplicate→navigate).
- Variants differ only in chrome (modal: close + "Open page"; page: back-link, Escape is a no-op
  beyond popover/title). Access stays server-enforced via `GetTodoById`.

### feat(branch): open a task's branch on its own page (2026-06-12)

- **Standalone branch page** at `/branch/{id}` (`app/branch/[id]`), behind the shared `AuthGuard` +
  `Navbar` layout.
- **Ctrl/⌘-click a task card** opens that branch page in a **new tab** instead of the in-place
  modal; a plain click still opens the modal as before.
- **"Open page" button** added to the branch modal's top chrome (grey, same row as the In Progress
  pill) that opens the page in a new tab.

### fix(branch): subtask reply sub-branch joins the subtask line; no tail after last reply (2026-06-12)

- Replies under a **subtask** now hang on the subtask's **own** sub-branch axis and inherit its
  line colour (green when done, amber in-work, grey idle), so the subtask branch flows straight
  into the reply avatars instead of detouring to the main rail. Message replies keep their indented
  elbow off the main rail.
- The reply rail is now drawn per-row and **stops at the last reply's avatar** — no dangling line
  segment below it. Consecutive avatars stay connected; the parent connector ends exactly at the
  first avatar.

### feat(todo): duplicate & restore completed tasks + clearer reply connector (2026-06-12)

- **Duplicate a task.** New owner-only `POST /todos/{id}/duplicate` (`DuplicateTodoCommand`) authors
  a fresh active copy server-side: copies title, description, priority, category (re-validated),
  visibility, shared audience (re-validated against current friendships), tags and required workers
  — but not the dates, completion state, or the branch (comments/subtasks). It emits the normal
  `TaskCreatedIntegrationEvent`, so the new branch's "created" comment and all participant
  notifications fire. A subtask can't be duplicated (404). Covered by new handler tests.
- **Completed-task "+" menu.** A completed task's branch menu now offers **Restore task** (reopen)
  and **Duplicate task** instead of being empty, styled as the existing menu action rows. Wired
  owner-gated through `EditTodoModal` → `BranchFeed` in the tasks, completed and dashboard pages
  (`duplicateTodo` API, `onDuplicate`).
- **Reply connector.** The reply sub-branch now visibly forks from its parent: a taller elbow rises
  along the main rail right under the parent message/subtask and curves into the thread's sub-rail,
  pulled tight to the parent so it's always clear which conversation a reply belongs to.

Backend Todo unit tests (127) and the full frontend suite (405) pass; `next build` compiles.

Security: duplicate is owner-only with server-side category/friendship re-validation; no cross-task forking

### feat(branch): nest replies into sub-branches under their root (2026-06-12)

Reworked how replies are laid out in the branch ("ветка") so they read as nested conversations
instead of one flat stream — the backend reply model is unchanged.

- **Threaded sub-branches.** A reply no longer sits inline on the main rail; it now hangs in a
  sub-branch beneath the message or subtask it ultimately descends from, rendered as a tidy
  indented column with its own sub-rail, an elbow branching off the main rail, and avatars sitting
  on the line (new `ReplyThread`). The model is two-level and flat: every reply in a root's chain
  lands in that one thread (no ever-deepening indentation), and chain depth is shown by quotes.
- **Quote visibility follows nesting.** A direct reply to a message or subtask shows **no quote**
  (its place in the sub-branch already says what it answers); only a reply to another reply shows
  the quote of the reply it answers. Computed by the new `resolveThreads` (`buildFeed`), which
  walks each reply's chain to its root; replies whose root is on an unloaded page fall back to a
  standalone main-rail row and rejoin once earlier messages load.
- No backend / API / schema changes — purely the frontend rail rendering. `next build`, `tsc` and
  the frontend suite (incl. `comments-api`) pass.

### feat(branch): replies to messages, replies & subtasks + subtask card byline (2026-06-12)

The branch ("ветка") timeline gains a full **reply system** and the subtask card gets the
author byline + footer work controls, with the existing branch visuals untouched.

- **Replies (Collaboration).** A comment can now quote another comment, another reply (chains),
  or a subtask. The quoted snapshot (`ReplyToType/Id/AuthorId/AuthorName`, preview ≤ 300 chars,
  `ReplyToDeleted`) is captured **server-side** — client preview text is never trusted. Quoted
  author identity is re-resolved live from Auth on every read; comment-target previews are
  refreshed from the live target in one batched query per page, so edits propagate. Deleting a
  target keeps the reply alive: comment deletions are detected live, subtask deletions flag
  quoting replies via the existing `SubtaskDeletedIntegrationEvent` consumer **without touching
  `UpdatedAt`** (no fake "edited" badges). The quoted author gets a dedicated `ReplyAdded`
  notification; cross-branch target ids return `404` exactly like missing ones (no oracle).
- **New gRPC contract.** `TodoService.GetSubtaskBrief(parent_task_id, subtask_id)` validates a
  subtask reply target where the task aggregate lives (INV-OWN-1) and returns the title + author
  for the snapshot; the Collaboration client fails closed (`503`) when Todo is unreachable.
- **Subtask author byline (Todo).** `GET /todos/{id}/subtasks` enriches each subtask with the
  author's live `authorName`/`authorAvatarUrl` (Auth `GetUserProfilesBatch`, one batch call,
  failure-tolerant); `POST /todos/{id}/subtasks` fills them from the creator's own JWT claims.
- **Frontend (branch-feed).** Hover **Reply** on every message; **Reply** in the subtask card
  footer; a height-animated "Replying to" chip above the composer (Esc peels it first, and no
  longer closes the modal); replies render a colour-keyed quote block (violet = message,
  amber = subtask, grey + `DELETED` when gone) that smooth-scrolls to the original with a
  `reply_flash` pulse. The subtask card footer now shows the author avatar + name on the left
  and, on the right, the **same** amber "N working" pill (hover→Leave crossfade preserved) plus
  an explicit **"Take into work"** button (white → ink hover, `Play` icon) matching the project's
  pill language. All existing rail visuals, markers and animations are unchanged.
- **Schema / ops.** Six nullable reply columns + a `(TaskId, ReplyToId)` index on
  `collaboration.comments`. Fresh installs get them via `EnsureCreated`; existing databases run
  the new idempotent `Planora.Migrator --upgrade-collaboration-replies` once.

Verified: `dotnet build` solution clean; Collaboration + Todo unit tests (170, incl. 11 new
reply tests) and the full frontend suite (405, incl. the new `comments-api` tests) pass;
`next build` compiles.

Security: reply targets validated server-side with branch-scoped lookups (no cross-task probing), snapshots never client-supplied

### fix(security): resolve all 45 CodeQL code-scanning alerts (2026-06-09)

Cleared every open code-scanning alert on the repository, plus two runtime defects and an
avatar regression surfaced while running the stack.

- **Log forging (36 × cs/log-forging).** Added `LogSanitizer` (strips CR/LF + control chars,
  length-caps) and routed all attacker-controlled values through it before logging: gateway
  request path/method/User-Agent/IP and the `X-Correlation-ID` header, the shared HTTP logging
  and global-exception middleware, CSRF middleware, the business-event logger, and the Realtime
  notifications controller.
- **PII in logs (7 × cs/exposure-of-sensitive-information).** Email addresses are no longer
  logged — `EmailService` masks the recipient and the auth handlers (password reset, email
  change, registration) correlate by user id.
- **Cleartext secret (1 × high, cs/cleartext-storage-of-sensitive-information).** Password-reset
  / verification links are no longer logged verbatim; the secret token is redacted.
- **Dockerfile (1 × DS-0026).** The one-shot `Planora.Migrator` image declares `HEALTHCHECK NONE`.
- **Runtime fixes.** `Planora.Migrator` crashed under EF Core 10 (ambiguous `AddDbContext`
  overload) and the API gateway was permanently unhealthy (Ocelot shadowed `/health/ready`);
  both fixed. `Start-Planora-Local.ps1` now injects the rotated `POSTGRES_PASSWORD` so local
  host-process startup works after credential rotation.
- **Avatar regression.** Next.js 16's image-optimizer SSRF block (private-IP upstreams) broke
  dev avatars; the optimizer is now bypassed in dev (`images.unoptimized`).

Verified: `dotnet build` clean, 800 backend tests + 401 frontend tests pass, `next build`
compiles. Code-scanning alerts close on the next CodeQL run.

Security: eliminates log forging, PII-in-logs, and cleartext reset-token logging across the stack

### fix(deps): clear transitive hono advisory + full security/performance audit (2026-06-08)

A comprehensive security, performance, and consistency audit of the whole stack. The
codebase was found to be reference-grade — no Critical/High/Medium defects — with a single
actionable dependency finding, now resolved.

- **Dependency fix.** `npm audit` flagged four moderate advisories in `hono` `<=4.12.20`
  (Set-Cookie injection, IPv6 deny-rule bypass, non-Bearer JWT scheme acceptance, mount-prefix
  mis-routing). The package enters the tree only transitively through the shadcn CLI via
  `@modelcontextprotocol/sdk` and never reaches the browser runtime bundle, so production
  exposure was nil. `npm audit fix` bumped only the pinned transitive `hono` version in
  `frontend/package-lock.json`; `package.json` and the dependency surface are unchanged. `npm
  audit` now reports zero vulnerabilities.
- **Audit coverage.** Verified across all six services: JWT validation + Redis security-stamp
  revocation, CSRF double-submit (timing-safe, scoped to Auth API per ADR-0005), gRPC
  service-key auth (timing-safe), IDOR hygiene (owner from JWT/context, id from route),
  refresh-token rotation with reuse-detection (chain invalidation + stamp rotation),
  `AsNoTracking`/`AsSplitQuery` on all reads, the composite covering index
  `ix_todo_items_user_status_deleted_created`, batched gRPC category enrichment (no N+1), all
  docker-compose ports bound to `127.0.0.1`, and frontend access-token-in-memory storage.

Security: clears all outstanding npm audit advisories (moderate); confirms no exploitable
findings across auth, gateway, gRPC, IDOR, secrets, and infrastructure exposure.

### Frontend task UX: instant updates, steadier title editing, per-user filter, marker-driven subtask work (2026-06-05)

A set of task-experience refinements on the dashboard, tasks pages, and the task-branch modal.

- **Instant task updates.** Creating a task now inserts it into the list immediately from the POST response and reconciles with a silent background refetch instead of blocking on a full reload behind a skeleton grid. The `planora:task-created` event carries the created task so the navbar quick-create appears instantly on both pages, and create/reopen refreshes no longer flash skeletons over existing cards (`fetchActiveTodos`/`fetchTodos` gained a `silent` mode).
- **Steadier title editing.** In the task-branch modal, the title heading and its inline edit field now share the exact same box model, so clicking the title to rename it no longer slides it sideways or resizes it — it fades cleanly into an editable field.
- **Per-user category filter.** The category filter on `/tasks` and `/tasks/completed` is persisted per user (`todos-cat-filter:<userId>`), so it survives a hard refresh but never leaks onto another account signed in on the same browser.
- **Marker-driven subtask work.** A subtask is now taken into work and completed through its single completion marker — there is no separate "lightning" button. First click takes it into work (per-user join), a second click completes it; while working a subtask, hovering its card reveals an exit-work control.

Performance: new tasks render instantly (optimistic insert) instead of after a blocking full-list refetch.
Security: per-user filter scoping prevents cross-account leakage of view state.

### feat(subtasks): per-user in-work with a worker count; hide all subtask system lines (2026-06-03)

**Per-user "in work" with a count.** Taking a subtask into work is no longer a global status —
it's now **per-user**, like the parent task's worker model:

- Frontend `toggleSubtaskWork` calls `joinTodo`/`leaveTodo` (not a status write); each participant
  joins/leaves independently. One person working never flips it "in work" for another.
- Every viewer sees an anonymous **"N working"** presence badge (`workerCount`); the viewer's own
  membership (`isWorking`) shows as "You're working" / "You + N working" and drives their toggle.
- Backend: the **owner-always-worker rule is relaxed for subtasks** (`TodoItem.AddWorker`), so the
  owner opts in like everyone and is counted; `JoinTodo`/`LeaveTodo` let the owner join/leave a
  subtask and **skip the "started working"/"left" activity events for subtasks** (no naming, no
  branch noise); `GetSubtasks` reports `IsWorking` from worker membership (owner included). Subtasks
  have unlimited worker capacity (`RequiredWorkers` is null). The live-merge now refreshes on
  `workerCount`/`isWorking` changes so other users' counts update without re-opening the modal.

**No stray "completed a subtask: <title>" lines.** `buildFeed` now hides **every** subtask system
comment (`added`/`completed a subtask:`) from the rail — matched or not — so legacy/renamed/orphaned
ones never reappear as standalone nodes. The folded completion reply text changed to
**"{Name} completed sub task"** (nameless fallback "Sub task completed").

Tests: +1 domain test (`AddWorker_OnSubtask_AllowsOwner`); existing worker/handler suites green
(53 in the touched sets). Frontend 393 vitest green; `tsc`/`eslint` clean; `npm run build` ok.

### feat(subtasks): anyone can take a subtask into work; all viewers see it (2026-06-03)

- **Taking a subtask into work is now global**, like completion. The frontend `toggleSubtaskWork`
  no longer requires ownership (the backend already authorised any participant to set a subtask's
  status), and the **Zap "take into work" toggle is shown to every viewer** on hover (editing and
  delete stay owner-only). So when *any* user picks up a subtask, the others see it.
- Polished the **"In progress" presence badge**: it now animates in/out (spring), uses a soft amber
  gradient pill with a pulsing dot, and is shown **to every viewer** on the card — it **never names
  who** is working (hover title: "Someone is working on this"). Derived from the subtask's live
  `status` (polled), so it appears for other users without re-opening the modal.
- Frontend only; `tsc`/`eslint` clean; 393 vitest green; `npm run build` ok.

### feat(subtasks): no creation notice, icon-less completion reply on a sub-branch (2026-06-03)

- **No "added a subtask" notification anywhere.** `CreateSubtaskCommandHandler` no longer enqueues
  the `SubtaskCreated` activity event (dropped its outbox dependency), and the frontend hides any
  legacy creation comments and renders no creation caption. The subtask card just appears.
- **Completion is an icon-less reply on the subtask's sub-branch.** The "completed a subtask" system
  comment is still posted to the parent branch but is never a standalone rail node — it renders as a
  reply hanging off the subtask via a soft "└" elbow, with **no rail icon/dot**, just
  "**{Name}** completed this · HH:MM".
- **Subtask system notifications carry no rail icons** — the only marker on the sub-branch is the
  subtask's own completion toggle, kept at the card's vertical centre.
- Polished the "reply"/branch visuals: a fork from the main rail to the toggle, a stem to the offset
  card, and a state-tinted sub-branch that continues down into the completion reply.
- Tests: `CreateSubtask` handler now asserts **no** outbox event (`Times.Never`) and the handler
  drops its `IOutboxRepository` dependency. Backend touched suites green (42); frontend 393 vitest
  green; `tsc`/`eslint` clean; `npm run build` ok.

### feat(subtasks): branch the subtask cluster off the rail (2026-06-03)

Refined the subtask cluster so it reads as a proper offshoot of the branch. All frontend
(`edit-todo-modal/branch-feed.tsx`).

- The whole cluster (creation caption, card, completion reply) is now **offset to the side**
  (`SUBTASK_OFFSET`) and joined back to the rail by short, state-tinted connectors — it clearly
  branches off like a reply, instead of sitting flush like a normal message.
- **Every subtask line keeps its own dot on the rail**, on par with other timeline events: a small
  indigo "added" dot for the creation caption, the completion toggle for the card, and a green node
  for the completion reply.
- The **completion toggle (the subtask's rail icon) is now vertically centred on the card** rather
  than pinned to the top — so tall/wrapped cards stay visually balanced.
- Dropped the now-redundant in-card list glyph (the rail toggle is the subtask's icon). The
  completion reply node is likewise centred on the rail with its note offset to the side.
- `tsc`/`eslint` clean; 393 vitest green; `npm run build` ok.

### feat(subtasks): fold lifecycle events into an integrated card cluster (2026-06-03)

Reworked how subtask system notifications appear in a task's branch so they feel native to the
thread instead of scattered rail nodes. All frontend (`edit-todo-modal/branch-feed.tsx`); the
backend events/templates are unchanged.

- **Folded the create/complete system comments into the subtask card.** `buildFeed` matches each
  `"… added a subtask: <title>"` / `"… completed a subtask: <title>"` comment to its subtask by the
  `: <title>` suffix, parses the actor name into a `SubtaskMeta`, and **hides them as standalone
  rail nodes**. The subtask now renders as one cluster:
  - a **minimalist creation caption** — "**{Name}** added a subtask · HH:MM";
  - the card (toggle = rail marker);
  - a **completion "reply"** the rail gently bends down to (curved connector → green check node →
    "**{Name}** completed this · HH:MM"). On optimistic completion a nameless "Completed" shows
    instantly, then the name fills in when the folded comment lands.
- **In-progress visible to everyone.** Taking a subtask into work shows an amber "In progress" pill
  with a pulsing dot to *all* viewers (derived from the live `status`, no name), replacing the old
  owner-centric "Working" badge.
- **Deletion still clears everything** — the folded comments are removed optimistically (suppressed
  ids) and server-side via the existing `SubtaskDeletedIntegrationEvent` cascade.
- New `SubtaskCompletionReply` component + curved SVG connector; spring enter/exit animations
  throughout. `tsc`/`eslint` clean; 393 vitest green; `npm run build` ok.

### fix(subtasks): schema-qualify the Title column widening (500 on long subtask) (2026-06-03)

The startup column-widening shipped in the 1500-char change targeted an unqualified `"TodoItems"`,
but the table lives in the **`todo` schema**. The `ALTER TABLE "TodoItems" …` threw
`42P01: relation "TodoItems" does not exist` (swallowed as a non-fatal warning), so the column
stayed `varchar(200)` and creating a subtask with a >200-char title failed with a Postgres
`22001: value too long` → HTTP 500. Fixed the statement to `ALTER TABLE todo."TodoItems" …` and the
`information_schema` guard to filter `table_schema = 'todo'`. The widening was also applied directly
to the running database, so existing local installs work without a rebuild.

### fix(tasks): keep the Quick Filter plate after creating a task (2026-06-03)

The Quick Filter plate on `/tasks` vanished after creating a task through the create panel. The
filter bar and the create panel shared one `AnimatePresence mode="wait"` swap; `handleCreate` flips
`isCreateOpen` and then immediately re-renders via `fetchActiveTodos` (`setLoading`), which
interrupted the deferred enter and left the filter collapsed at height 0. They are now two
independent `AnimatePresence` presences, so closing the create panel (on submit or via Close)
always re-reveals the filter. Frontend `tsc`/`eslint` clean; 393 vitest green; build ok.

### feat(subtasks): allow up to 1500-character subtask titles (2026-06-03)

A subtask's whole content lives in its title, so subtasks now accept **up to 1500 characters**
(regular-task titles stay ≤200). Updated every layer: `CreateSubtaskCommandValidator` (200→1500),
`UpdateTodoCommandValidator` (200→1500, since subtask renames share `PUT /todos/{id}`), the EF
`TodoItems.Title` column (`varchar(200)`→`varchar(1500)`), and the frontend `SUBTASK_MAX`
(200→1500). The inline subtask editor became an auto-growing **textarea** so long titles are
comfortable to edit; regular `CreateTodo` titles remain capped at 200.

- **DB reconciliation:** the Todo service runs an idempotent, metadata-only `ALTER TABLE
  "TodoItems" ALTER COLUMN "Title" TYPE varchar(1500)` at startup (guarded by an `information_schema`
  check) so existing migration-built databases get the wider column without a committed migration;
  fresh installs get 1500 straight from the EF model.
- Tests: EF model-config (1500), Todo validator (subtask 1500 accept / 1501 reject; update path
  1500), and the error-handling integration update-title case (now 1501) — backend touched suites
  green. Frontend 393 vitest green; `tsc`/`eslint` clean; `npm run build` ok.

### feat(branch): drop modal footer, wrap subtask titles, empty "+" when done (2026-06-03)

- **Removed the Task Branch modal footer** — the "Changes save automatically / All changes saved"
  autosave-status panel, the `View only` label and the `Done` button are gone. Editing still
  autosaves (the `useAutosave` hooks are untouched); the modal closes via the header **✕**, the
  backdrop, or `Escape`. Dropped the now-unused `AutosaveIndicator` wiring from the modal.
- **Long subtask titles now wrap** instead of truncating with an ellipsis. The subtask card is
  flexible-height (`align-items: flex-start` + `overflow-wrap`), so a long step grows the card
  downward to fit the branch width and the `layout` spring animates the height change.
- **The compose "+" menu is empty on a completed task** — description, subtask, and the
  take-into-work / complete actions are all hidden once the task is done, and the menu doesn't open
  (no empty popover).
- Tests/build: updated the two `EditTodoModal` footer assertions (no more "Changes save
  automatically" / "View only" text); 393 vitest green; `tsc`/`eslint` clean; `npm run build` ok.

### feat(subtasks): task-like cards, delete cascade, composer auto-close (2026-06-03)

Follow-up polish on the inline subtask cards.

- **Composer auto-closes** after a subtask is created — submitting returns the compose box to
  plain-message mode instead of staying in subtask mode.
- **Delete affordance now matches a regular task card** — the inline trash icon is replaced by the
  same **slide-from-right red panel** (clip-path reveal + spring trash icon) used on task cards.
- **Taller, more task-like card** — bigger glyph, roomier padding, and a `Subtask · HH:MM` meta line
  under the title so a step reads like a compact task rather than a checklist row.
- **Deleting a subtask now also removes its branch announcements.** A subtask owns no branch, so
  TodoApi emits the new `SubtaskDeletedIntegrationEvent(parentTaskId, subtaskId, actor, title)`
  (instead of `TaskDeletedIntegrationEvent`, which would wipe a whole branch). Collaboration's new
  `SubtaskDeletedEventConsumer` → `ICommentRepository.SoftDeleteSubtaskActivityAsync` soft-deletes
  the parent-branch system comments ending with `added a subtask: {title}` / `completed a subtask:
  {title}`. The client removes them optimistically and suppresses their ids so polling can't
  re-add them before the async cascade lands.
- **Statistics (already in place, reconfirmed):** an incomplete subtask never counts in the active
  task counter (`parentTodoId` filtered out), a completed subtask **does** count toward the weekly
  completed stat (`includeSubtasks=true`), and subtasks never appear on `/tasks/completed` (the
  list endpoints keep the default `ParentTodoId == null` filter).
- Tests: +1 Collaboration consumer case (subtask-delete targets the parent branch + title, never a
  whole-branch wipe) and +1 Todo handler case (subtask delete enqueues `SubtaskDeletedIntegrationEvent`
  for the parent) → 42 in the touched suites green. `tsc`/`eslint` clean; changed .NET libraries build clean.

### refactor(subtasks): inline branch cards, no panel, no priority (2026-06-02)

Reworked the subtask UX so a subtask is **a regular branch event**, authored just like the task
description — not a separate panel.

- **Removed** the standalone Subtasks panel (`edit-todo-modal/subtasks-section.tsx` and its test)
  that sat below the comments with its own header, progress bar and "Add" button.
- **Authoring mirrors the description flow.** A new "Subtask" entry in the compose "+" menu switches
  the **same input field** into subtask mode; plain `Enter` adds the step and the field stays in
  subtask mode for quick successive entry. No separate composer.
- **Inline rendering.** Each subtask now renders as a **simplified task card on the activity rail**
  (`branch-feed.tsx` → `SubtaskCard`), interleaved chronologically and anchored **directly after its
  "added a subtask" system event** (matched by the `: <title>` suffix) — never pinned to the top. The
  completion toggle doubles as the rail marker, sitting exactly on the timeline line.
- **No priority.** The priority picker/dot is gone from subtask create and edit; only the title is
  authored/edited. The entity column still defaults server-side but is never surfaced.
- Live polling/merge now refreshes subtasks alongside comments (id-keyed, optimism-preserving), so
  another participant's add/complete/edit appears without re-opening the modal. Per-row complete
  (everyone) / inline title edit + take-into-work + delete (owner) retained, with satisfying
  spring-based toggle, enter and exit animations.
- Tests/build: removed the obsolete `SubtasksSection` component test; `subtasks-api` tests green;
  `tsc` + `eslint` clean; `npm run build` succeeds.

### feat(subtasks): branch system messages on create/complete + non-bold rendering (2026-06-02)

- Creating or completing a subtask now posts a **system message to the parent task's branch**
  ("X added a subtask: …" / "X completed a subtask: …"). Reuses `TaskActivityIntegrationEvent`
  with new `SubtaskCreated`/`SubtaskCompleted` types and an optional `Detail` (the subtask title);
  the Collaboration `TaskActivityEventConsumer` formats the sentence on the parent's timeline.
  `CreateSubtaskCommandHandler` and both completion paths in `UpdateTodoCommandHandler` (owner and
  non-owner global completion) enqueue the event via the outbox.
- Subtasks (title only, no description) now render **non-bold** in the branch, so a step reads as a
  plain entry, lighter than the bold Author's Note.
- Tests: +2 backend consumer cases (subtask sentence incl. title, posted to the parent id) and
  outbox-emission assertions on create/complete → backend suite 155 green; frontend 400 green.

### feat — subtasks: tree-structured child tasks inside a task's branch (2026-06-02)

Tasks can now be broken into **subtasks** — child `TodoItem`s (self-referencing `ParentTodoId`)
that live **only** in the parent task's branch and never appear on any list/page.

- **Todo backend.** `TodoItem.ParentTodoId` + `CreateSubtask` (inherits the parent's category,
  public flag and shared audience; own priority; no due/expected date; no nesting) and
  `SyncInheritedFromParent`. EF self-FK (NoAction) + index + migration `AddSubtaskParentTodoId`.
  `CreateSubtaskCommand` and `GetSubtasksQuery` (owner-create; owner/friend list with the
  `GetTodoById` visibility predicate). Endpoints `POST`/`GET /todos/api/v1/todos/{id}/subtasks`.
  Completion is **global** — anyone who can see the parent may complete/reopen a subtask and it
  applies for everyone (entity status, not per-viewer); editing a subtask's title/priority is
  **owner-only**. `UpdateTodo` rejects editing a subtask's inherited fields and **propagates** a
  parent's category/visibility/sharing to its children;
  `DeleteTodo` soft-deletes the whole subtree. List queries exclude subtasks; `GetUserTodos`
  gains `includeSubtasks` so **completed subtasks still count toward the weekly dashboard stat**.
- **Frontend.** New "Subtask" entry in the branch "+" menu; `edit-todo-modal/subtasks-section.tsx`
  renders an animated checklist (progress bar, smooth add/remove). Anyone with access can complete;
  the owner can inline-edit title + priority (double-click or pencil), take into work, and delete. `fetchSubtasks`/`createSubtask`/`updateSubtask`/
  `deleteSubtask` API helpers; `Todo.parentTodoId`. Dashboard counts completed subtasks weekly while
  excluding them from the active counter and the grid.
- **Tests/docs.** 10 backend handler/security tests (inheritance, foreign-parent + nesting rejection,
  owner-only edit guard, non-owner global completion, parent→child propagation, cascade delete,
  access control) — Todo suite 121 green; 11 frontend tests (API helpers + `SubtasksSection`) —
  suite 400 green. IDOR coverage doc + features doc updated. Backend builds clean (.NET 10);
  `tsc`/`eslint` clean; frontend branch coverage ≥85%.

### feat(frontend) — quick-save (autosave) for the task-branch and category edit modals (2026-06-02)

Removed the manual **Save/Cancel** buttons from the editing modals: every committed change now
persists automatically, as soon as it is applied.

- **New `useAutosave` hook** (`frontend/src/hooks/use-autosave.ts`) — a debounced, single-flight
  autosave engine: it coalesces bursts (typing, color-picker drags) into one write, never persists a
  value equal to the last-saved baseline, runs at most one request at a time (re-firing if the value
  changed mid-flight so the final state always lands), exposes `idle/saving/saved/error` status, and
  `flush()`es any pending change on explicit close and on unmount so nothing is lost. A `validate`
  guard blocks invalid saves (e.g. an empty name/title) and `reset()` re-anchors the baseline when the
  edited entity changes.
- **New `AutosaveIndicator`** (`frontend/src/components/ui/autosave-indicator.tsx`) — a quiet
  `role="status"` `aria-live="polite"` confirmation (`Saving… / All changes saved / Couldn’t save`)
  that replaces the Save button as the only signal a change reached the server.
- **Task Branch edit modal** (`edit-todo-modal/modal.tsx`) — title, priority, due date, category, and
  visibility/sharing autosave. Owners persist the full task payload; a shared viewer autosaves only
  their private category preference. The description ("Author's Note") keeps its own editor and is
  excluded from the autosave equality check to avoid a duplicate write. The footer now shows the
  indicator (or `View only`) plus a `Done` close button. `tasks/page.tsx` `handleUpdate` /
  `handleSaveViewerPreference` no longer close the modal or toast per save, update the list optimistically,
  and re-throw on failure so the indicator can show the error state and retry.
- **Category edit modal** (`categories/page.tsx`) — name, description, color, and icon autosave with an
  optimistic grid update; an empty name shows an inline hint and is never persisted. **Creating** a
  category intentionally keeps a single explicit `Create category` button (nothing exists to autosave
  yet), with no Cancel button.
- **Tests** — added `frontend/src/test/hooks/use-autosave.test.tsx` (12 cases: debounce, baseline,
  status, revert, validation, enable/disable, error, flush, reset, single-flight, unmount flush) and
  `frontend/src/test/components/autosave-indicator.test.tsx`; rewrote the four `EditTodoModal` tests for
  autosave. Full suite: **389 green**, `tsc --noEmit` and `eslint .` clean.

### fix(ci) — green markdownlint + restore branch-coverage threshold (2026-06-02)

- Converted every remaining `*`-style list bullet in `CHANGELOG.md` to `-` (272 MD004 violations).
  The markdownlint CI job lints all root `*.md`, so the historical asterisk bullets were failing it;
  the whole tree now lints with **0 errors**.
- Added `frontend/src/test/components/quick-filter-bar.test.tsx` covering the new `QuickFilterBar`
  (idle vs active states, single/plural summary, the +N chip overflow, the icon/colour-fallback chip
  branches, and the open/clear callbacks). The component had shipped without tests and dragged global
  **branch coverage to 84.75%**, below the 85% gate; it is now **85.64%** and the suite is 374 green.

### build — drop redundant framework packages (NU1510), clean `-warnaserror` build (2026-06-01)

Removed three `PackageReference`s that the .NET 10 SDK flags as redundant via **NU1510** (they are
already provided by the shared framework / transitively): `Microsoft.Extensions.Caching.Abstractions`
(BuildingBlocks.Infrastructure), `Microsoft.Extensions.Logging.Abstractions` (BuildingBlocks.Application,
which already has a `Microsoft.AspNetCore.App` framework reference), and
`Microsoft.Extensions.Diagnostics.HealthChecks` (Planora.ApiGateway). The solution now builds with
**0 warnings / 0 errors** even under a strict restore + `dotnet build -warnaserror`, not only under the
CI sequence (which restores separately). The CS0105 duplicate-using and the Collaboration
`AddPlanoraSwaggerGen`/`UsePlanoraSwagger` errors from older build logs were already resolved in the
current `net10.0` code.

### docs — comprehensive, marketing-grade README overhaul (2026-06-01)

Rewrote `README.md` into a richer, more polished landing page that reads for both engineers and a
product audience: a centered hero, a "Why Planora" benefits section, a feature tour, and an explicit
**tech-stack table that links every major dependency** (NuGet/npm) with its pinned version (sourced
from `Directory.Packages.props` and `frontend/package.json`). Expanded the configuration reference
into Required + Common-optional tables grounded in `.env.example`, corrected the Auth service port to
`5030` (gRPC `5031`), and added the full documentation index. Allowed the centered HTML hero in the
markdownlint config (`MD041: false`); the README passes markdownlint with zero errors.

### fix(frontend) — modal stays open on leave (dashboard), branch text wraps, greyscale event icons (2026-06-01)

- **Leaving work no longer closes the branch modal from the dashboard.** `dashboard/page.tsx`
  `handleLeave` called `setEditingTodo(null)`, which closed the modal whenever the user stopped the
  in-progress status from there. It now updates the open todo in place (status/`isWorking`) without
  closing — matching the header-pill and "+"-menu paths and the active-feed behaviour.
- **Long unbreakable text wraps instead of scrolling sideways.** Added `overflow-wrap: anywhere` /
  `word-break: break-word` to the message body, the Author's Note, and system-event text, so a giant
  word or URL with no spaces wraps onto the next line rather than producing a horizontal scrollbar.
- **System-event rail markers are now greyscale and simpler.** Replaced the coloured per-event icons
  with a single calm grey marker and simpler glyphs (`getSystemEventIcon`): created = Plus, started =
  Play, left = LogOut, completed = Check, other = Circle.

### feat(frontend) — redesigned, unbroken branch activity rail with event-typed markers (2026-06-01)

The task-branch timeline rail is now a single continuous gradient line that lives in a content-height
wrapper, so it spans the whole feed and no longer breaks/stops once there are enough messages to
scroll (the old line was anchored to the scroll viewport via `top/bottom`). Every marker is now
mathematically centred on the rail (shared `RAIL_GUTTER`/`RAIL_CENTER` geometry) instead of sitting
slightly off to the side. System-event markers are no longer a generic grey dot: `getSystemEventMeta`
maps each event to a meaningful icon + colour — created (Sparkles/violet), started working
(Zap/indigo), left (LogOut/red), completed (CheckCircle2/emerald) — rendered in a tinted ring centred
on the line. The previous `getSystemEventColor` (which only matched Russian phrases and so always fell
back to grey for the actual English event sentences) was removed.

Docs: reviewed the last 20 commits and reconciled the documentation — updated the `docs/features.md`
branch/Frontend-Behavior section to describe the new rail + typed markers; verified the Outbox/Inbox,
signal-dispatch, LAN-sharing, and launcher docs already match the code.

### docs — accurate launcher help + documentation refresh (2026-06-01)

Rewrote the `Start-Planora-Local.ps1` comment-based help (`.SYNOPSIS`/`.DESCRIPTION`/`.PARAMETER`/
`.EXAMPLE`/`.NOTES`) and the `-Help` usage so they fully and accurately describe the current
behaviour: the 10-step startup pipeline, every flag (including `-Lan`), the default ports/URLs, the
per-service schema bootstrap (the launcher runs **no** separate migration step), secret handling, and
logs/lifecycle. Corrected the README local-dev section (it previously claimed the launcher "applies
schemas through the migrator", which it does not) and added a flag table + port list. Updated
`docs/OPERATIONS.md`, `docs/codebase-map.md`, and the `docs/configuration.md` LAN section to reflect
that LAN sharing is now automatic via `-Lan` + the dev CORS/CSP allowances + runtime `getApiBaseUrl()`
(only email-link `Frontend__BaseUrl` still needs the LAN IP).

### feat — one-command LAN sharing over Wi-Fi (VPN-safe) (2026-06-01)

Added `-Lan` to `Start-Planora-Local.ps1` so a teammate on the same Wi-Fi can open the running app.
The launcher resolves the host's physical LAN IPv4 via `Get-NetAdapter -Physical` (which excludes VPN
virtual adapters, so a split-tunnel VPN's tunnel address is never handed out), opens a Windows Firewall
inbound rule for ports 3000 + 5132 scoped to `Profile Any` + `RemoteAddress LocalSubnet` (self-elevating
once if needed), and prints the shareable `http://<lan-ip>:3000` URL plus VPN guidance. The frontend
already binds `0.0.0.0` and `getApiBaseUrl()` auto-targets the gateway on whatever host the page was
opened from, so peers need zero configuration.

To make this work end-to-end in development without per-IP wiring: the API gateway's dev CORS policy now
accepts loopback **and** RFC1918 private-LAN origins (via a bounded `SetIsOriginAllowed` predicate — dev
policy only, production stays an explicit allow-list), and the frontend's dev CSP `connect-src` now
allows `http:/https:/ws:/wss:` (mirroring the existing dev `img-src`), so a browser served from a LAN IP
can reach `http://<same-host>:5132`. Production CSP/CORS are unchanged.

### fix(frontend) — leaving work keeps the branch modal open + faster status-comment catch (2026-06-01)

The header pill's "Leave" action called `onClose()`, so stopping work closed the whole branch modal.
Removed it — leaving (by the pill or the "+" menu) now keeps the modal open, and the "left the task"
system comment appears in-place. Also tightened the post-action catch-up merge schedule
(250 ms → 5.6 s, denser early) so the status system-comment surfaces almost immediately once the
signal-driven outbox dispatch has published it.

> Note: the near-instant dispatch requires the **Todo service to be running the rebuilt binary**. A
> still-running pre-change Todo API keeps the old 5 s poll cadence until restarted.

### perf/feat — instant outbox dispatch, unified Quick Filter bar, non-owner date popover (2026-06-01)

**perf(outbox): task-lifecycle system comments now appear near-instantly instead of after ~20 s.**
The `OutboxProcessor` only polled every 5 s, so a "started working / left / completed" event could wait
out a poll tick on the producer *and* be missed by the branch's early catch-up refetches — feeling like
a 20 s delay. Added signal-driven dispatch: a new `OutboxSignal` (in-process singleton) plus
`OutboxNotifyInterceptor` (an EF `SaveChangesInterceptor` on `TodoDbContext`) pulse the processor the
moment a transaction that inserted an outbox row commits, so it publishes in milliseconds; the 5 s poll
stays only as a safety net, and a full batch is drained in a tight loop. Consumption is already
push-based (RabbitMQ), so the Collaboration system comment now lands in the branch in well under a
second. The signal is optional — services that do not register it fall back to pure polling unchanged.

**feat(frontend): the applied-filter summary now lives inside the Quick Filter bar (no layout shift).**
On /tasks and /tasks/completed the active-filter info was a separate block that pushed the page around.
Extracted a shared `QuickFilterBar` component: when a filter is applied, the category chips + count +
clear button crossfade into a fixed-height subtitle row *inside* the same plate, so toggling a filter
never grows or jolts the block. Removed the duplicated inline plates and the standalone "Filter Active"
chip / "F" hint blocks from both pages.

**feat(frontend): non-owner date popover hides the quick-pick row.** A viewer who is not the task owner
opens the date token read-only; the Today/Tomorrow/+3 days/Next week shortcuts are now omitted entirely
rather than shown disabled, leaving just the read-only calendar.

### fix — branch comment edit/delete 409, live branch updates, open-at-bottom, completed-page filter plate (2026-06-01)

**fix(collaboration): comment edit/delete always failed with a spurious concurrency conflict.**
`CommentRepository` overrode the base `GetByIdAsync` purely to add `AsNoTracking()`. The `Comment`
aggregate uses PostgreSQL's `xmin` as an optimistic-concurrency token (a shadow property captured only
on a *tracked* read), so the no-tracking load dropped it and the subsequent UPDATE/soft-delete issued
`WHERE xmin = 0`, matched zero rows, and threw `DbUpdateConcurrencyException` → 409 "The record has been
modified by another user." Removed the override so mutations inherit the tracking base. The author-only
edit rule (`Comment.UpdateContent`) and the frontend gating the edit button on `isOwn` were already
correct; this only fixes the false conflict.

**feat(frontend): the task branch now updates live without re-opening the modal.** With no realtime
socket in the app, `BranchFeed` polls the newest page every 5 s (paused while editing) and merges by
comment id, so other participants' messages/edits and the asynchronously-materialised status
system-comments appear on their own. Taking a task into work / leaving / completing additionally
schedules short catch-up merges (≈0.6 / 1.5 / 3 s) so the status event shows within a second or two
even though it is produced via Outbox→Inbox after the action returns.

**feat(frontend): the branch opens at the newest message.** The rail pins to the bottom on first load
and after take/leave/complete; "load earlier" and description edits preserve scroll position.

**feat(frontend): /tasks/completed gets the same Quick Filter plate as /tasks.** The active-filter chip
was rendered inside the completed-archive hero/stats card; it is now a standalone row and the page shows
the identical "Quick Filter" plate (SlidersHorizontal + "F to filter" + Open Menu button) below the
header, matching /tasks exactly.

### feat(frontend) — sticky Author's Note + task actions in branch compose menu (2026-06-01)

The Author's Note (task description) is now part of the scrollable branch rail instead of living
outside it. It scrolls away naturally; once it leaves view a condensed frosted-glass bar appears at
the top of the feed with the author's avatar, the truncated first line, and a gently-bouncing chevron.
Clicking the bar smooth-scrolls back to the full card and fires a violet attention-pulse animation so
the note is effortless to find. The bar enters/exits with a spring via Framer Motion `AnimatePresence`.

The compose "+" menu now surfaces two task-action items (available to all participants, not just the
owner): **Take into work** (→ Leave task when already in progress, toggle) and **Complete task** (→
Reopen when already completed). Both mirror the existing join/leave/complete flow precisely — no new
API or logic — and emit the same system comments and toasts the cards do. The "Description" attachment
item is now hidden for non-owners (only the author can set a task description). An optimistic
`workOverride` flag in the modal makes the in-progress pill in the header flip instantly on "Take into
work" / "Leave" before the parent refetch propagates back.

### fix(frontend) — lock owner-only fields for viewers + fixed-size branch modal (2026-06-01)

Two issues in the branch/edit modal. (1) When a non-owner opened a public task's branch modal, the
priority, due-date and visibility tokens were fully editable — the gate keyed off
`canManageViewerCategory`, which is `true` for shared tasks because a viewer may set their *own*
category, so it leaked write access to fields that belong to the author. These three tokens are now
rendered muted for non-owners and open a read-only (greyed, non-interactive) preview on click, while the
category token stays editable for viewers as intended; the title was already owner-gated. (2) The modal
resized to its content — short for an empty branch, tall for a full one. It is now a fixed size (90vh,
capped at 880px) with the timeline flex-filling and scrolling internally, so it is always the same
maximum size regardless of how much the branch contains.

### feat(frontend) — category filter on the Completed Tasks page (2026-06-01)

The `/tasks/completed` page now has the same category filter as `/tasks`: the "F" hotkey toggles the
category filter modal, an active-filter chip shows the selected categories with a one-click clear, and
the hint kbd appears until first use. The selection is persisted in the same shared store as the active
page, so the filter is consistent across both. Filtering is applied client-side to the loaded archive
page (matching how the active feed filters).

### fix(a11y) — associate auth form labels + name the password-visibility toggles (2026-06-01)

Audit follow-up. The auth forms (login, register, forgot-password, reset-password, verify-email)
rendered each `<label>` as a sibling of its input with no `htmlFor`/wrapping, so screen readers did
not announce the field name on focus. Each field is now programmatically labelled — the reusable
register `InputField` wraps its control in the `<label>`, and the inline forms use `htmlFor` + matching
`id`. The icon-only show/hide-password buttons gained an `aria-label` ("Show/Hide password") so they
have an accessible name. Verified: frontend lint, type-check, 370 tests, and the production build pass.

### fix — idempotent event consumers + read-query tracking (audit follow-ups) (2026-06-01)

Two findings from the repository-wide audit.

- **Consumer idempotency (INV-COMM-4) was claimed but not implemented.** `RabbitMqEventBus`
  delivers at-least-once (nack + requeue on failure), but no consumer deduped — the
  `IdempotentMessageHandler`/Inbox machinery was dead code, so a redelivered or restart-replayed
  event produced duplicate system comments (Collaboration) / notifications. The event bus now
  dedups centrally on the stable `@event.Id` via an `IInboxRepository`: it skips a handler when the
  event id is already recorded and records it after success. The check is **graceful and defensive**
  — a service that registers no inbox (or an inbox error) falls back to processing exactly as before,
  never worse. Added an `InboxMessages` table + repository to Collaboration (keyed on the event id);
  Realtime is a follow-up. Verified live: the inbox records the processed `TaskCreatedIntegrationEvent`
  and exactly one "created the task" system comment is produced.
- **`AsNoTracking` on CategoryApi read queries.** The shared `BaseRepository` already applies
  `AsNoTracking` to its reads, but the custom `CategoryRepository` did not. Added it to the
  read-only methods (list/get/paged) while keeping change-tracking on `GetByIdAsync` (load-then-update
  path) and `FindAsync` (also used for fetch-then-RemoveRange).

Note: the Collaboration `InboxMessages` table is created by `EnsureCreated` on a fresh database
(the Collaboration bootstrap convention); existing dev databases should be recreated to pick it up.

### fix(security) — stop CategoryApi leaking raw exception messages to clients (2026-06-01)

The four CategoryApi handlers (Create/Update/Delete/GetUserCategories) caught all exceptions and
returned `ex.Message` in the failure `Result`, surfacing internal/DB detail (e.g. "database
unavailable") to API consumers. They now log the full exception and return a safe, generic message.
Found during the repository-wide audit. (Other services already let domain exceptions bubble to the
sanitising global exception middleware.)

Security: removes an information-disclosure vector (internal error detail in API responses).

### refactor — task description is a single source of truth; live author identity (2026-06-01)

Removed a cross-service data-duplication class of bug. The task description was stored twice — as
`TodoItem.Description` (shown on the card) **and** as a "genesis" comment in the Collaboration DB
(shown in the branch). They synced only at creation (via an async event), so: tasks created before
the Collaboration service had an empty branch; new tasks' descriptions appeared only after the
outbox cycle; and edits via the two paths could diverge.

**P1 — description = single source of truth (Todo).** Collaboration no longer stores a genesis
comment. `TodoService.CheckTaskCommentAccess` now also returns the live `description` +
`taskCreatedAt`, and `GetCommentsQueryHandler` **synthesises** the pinned "Author's Note" from it on
read (page 1 only; `id` = task id, author = task owner). Result: the description shows instantly,
always matches the card, and is present for old tasks. The frontend edits it on the task
(`PUT /todos`) via a new `onSaveDescription` path; the `POST .../genesis` endpoint, the
`AddGenesisComment` command/handler/validator, and `Comment.CreateGenesis`/`UpdateGenesisContent`
were removed. Legacy stored genesis rows are excluded by the read query.

**P2 — author identity resolved live.** `Comment.AuthorName` was a stored copy of the Auth-owned
name that went stale after a rename (while the avatar beside it was already live). Added
`AuthService.GetUserProfilesBatch` (name + avatar); Collaboration now resolves comment + genesis
author identity live (60 s cache), with the stored name kept only as an offline fallback.

Verified end-to-end on a live local stack: a task created with a description returns the Author's
Note on an immediate (0 s) fetch with the author name resolved live, and editing the description on
the task is reflected in the branch. Backend builds under `-warnaserror`; all backend + frontend
tests pass on net10.0.

### fix — task timeline appears promptly + navbar avatar alignment (2026-05-31)

Two user-reported bugs.

- **"No messages yet" on a task that has a description.** A newly created task's
  Collaboration timeline ("ветка") is materialised asynchronously: TodoApi publishes
  `TaskCreatedIntegrationEvent` through its outbox, and Collaboration's consumer writes the
  "created the task" system comment and the genesis (description) comment. The shared
  `OutboxProcessor` (and Messaging's `OutboxProcessorJob`) polled every **30 s**, so opening
  the task within that window showed an empty timeline even though the description existed.
  Verified end-to-end: the comments are created correctly, just late. Cut the poll cadence to
  **5 s** (the query is indexed and `Take(20)`-bounded), so the timeline — and message delivery —
  becomes near-live. Reproduced and confirmed: ~11 s after creating a task the endpoint now
  returns both the system and genesis comments (`totalCount: 2`).
- **Navbar avatar sat slightly too high.** The avatar's wrapper was a block container whose
  child `<button>` defaulted to `inline-block`, so it aligned to the text baseline (leaving
  line-descender space below) and rode a few px above the flex-centred logo/tabs. Made the
  wrapper `flex items-center` so the button is vertically centred like its siblings.

### build — migrate the backend from .NET 9 to .NET 10 (LTS) (2026-05-31)

Moved the entire backend to **.NET 10** (10.0.8 runtime), applying the Dependabot
`dotnet/sdk` and `dotnet/aspnet` 9→10 image bumps as a coherent framework migration
rather than a tag-only change (a net9 app cannot run on the `aspnet:10.0` runtime).

- **Target framework** — `Directory.Build.props` and all 32 `.csproj` now target `net10.0`.
- **Packages** — every runtime-aligned `Microsoft.*` package (EF Core, ASP.NET Core,
  Extensions.*, Diagnostics.HealthChecks.*, Mvc.Testing) moved 9.0.15 → 10.0.8, and
  `Npgsql.EntityFrameworkCore.PostgreSQL` 9.0.4 → 10.0.2.
- **Framework-provided packages** — dropped the explicit `System.Text.Json` /
  `System.Text.Encodings.Web` references (now supplied by the shared framework; the old
  10.0.7 pin was also a downgrade from the framework's 10.0.8). Removed the unused
  `Microsoft.AspNetCore.OpenApi` reference from all six service APIs — the project uses
  Swashbuckle, and that package pulled Microsoft.OpenApi v2, which broke Swashbuckle 6.9.0
  (CS7069). `NU1510` (package pruning advisory) is kept as a non-blocking warning.
- **API deprecations fixed** — `ForwardedHeadersOptions.KnownNetworks` →
  `KnownIPNetworks` (gateway, ASPDEPR005); `Rfc2898DeriveBytes` constructors →
  the static `Rfc2898DeriveBytes.Pbkdf2` (Auth `PasswordHasher`, SYSLIB0060). The
  password hash is **byte-identical** (same salt, 100k iterations, SHA-512, UTF-8), so
  existing stored hashes keep verifying.
- **Images & CI** — all 7 service Dockerfiles and the Migrator runtime image bumped to
  the `10.0` tags; `actions/setup-dotnet` pinned to `10.0.x` across every workflow.
- **SDK resolution** — added `global.json` (`sdk` 10.0.100, `rollForward: latestMajor`)
  so a machine without the .NET 10 SDK gets a clear "install 10.x" error instead of a
  cryptic `NU1202`. `Start-Planora-Local.ps1` now resolves a .NET 10 SDK automatically
  (system → side-by-side `%USERPROFILE%\.dotnet` → one-time local auto-install) and puts
  it on PATH for the build and the service processes, so the launcher works even when the
  machine default `dotnet` is still .NET 9.

Builds clean under `-warnaserror` and all 791 backend tests pass on net10.0. A full local
health-check (`Start-Planora-Local.ps1 -ExitAfterHealthCheck`) reports all services
Healthy on .NET 10.

Security: no change to the password hashing parameters or output; the migration only
swaps the obsolete API for its supported static equivalent.

### feat — extract task comment timeline into the Collaboration microservice (2026-05-29)

The task comment timeline ("ветки") — user, genesis, and system comments — moved out of TodoApi
into a new **Collaboration** service (`Services/CollaborationApi`, database `planora_collaboration`,
gateway prefix `/collaboration/api/v1/comments`). The new service follows the exact platform
template: clean architecture, BuildingBlocks wiring, Serilog + OpenTelemetry, the shared global
exception middleware, JWT + security-stamp validation, rate limiting, response compression, health
endpoints, the Outbox pattern, and a non-root Dockerfile.

**Responsibility split.**

- TodoApi no longer contains any comment code. It now publishes task-lifecycle integration events
  through its own outbox — `TaskCreatedIntegrationEvent`, `TaskActivityIntegrationEvent`
  (completed/started/left), `TaskDeletedIntegrationEvent` — and exposes `TodoService.CheckTaskCommentAccess`
  over gRPC. The EF migration `RemoveCommentsAddOutbox` drops `todo_item_comments` and adds `todo.OutboxMessages`.
- Collaboration owns `collaboration.comments`. It authorises every read/write via the Todo gRPC
  access check (owner / shared / public + friendship — never reading Todo's DB, INV-OWN-1),
  materialises system/genesis comments from the Todo events through idempotent Inbox consumers,
  and fans out a `NotificationEvent` per participant on each new comment (Outbox → RabbitMQ →
  Realtime/SignalR).

**Errors & validation.** gRPC faults from the Todo access check surface as HTTP 503 via a
`DomainException` (`ExternalServiceUnavailableException`); FluentValidation validators reject
malformed input as 400 through the shared `ValidationBehavior`.

**Data migration.** `Planora.Migrator --backfill-collaboration` idempotently copies
`todo.todo_item_comments` → `collaboration.comments`; run it before applying `RemoveCommentsAddOutbox`.

**Frontend.** Comment API calls repoint to `/collaboration/api/v1/comments/*`; the `CommentDto` JSON
shape is unchanged so the timeline UI is untouched.

**Tests.** Added Collaboration domain, handler (access matrix + notification fan-out), and
integration-event consumer (replay-safe materialisation, cascade/user-deletion) suites, plus
`WorkerLifecycleEventTests` pinning the new event-based worker lifecycle in TodoApi.

**Docs.** Updated `architecture.md`, `database.md`, `API.md`, `codebase-map.md`, `features.md`,
`testing.md`, `security-idor-coverage.md`, `overview.md`, `index.md`, `glossary.md`, and `INVARIANTS.md`.

### fix — genesis comment edits up to 5000 chars (Collaboration) (2026-05-31)

`UpdateCommentCommandValidator` capped every comment edit at 2000 characters, but a
genesis comment (the task description) is allowed up to 5000 — both on create
(`AddGenesisCommentCommandValidator`) and in the domain (`Comment.UpdateGenesisContent`).
The blanket validator ceiling ran in the `ValidationBehavior` pipeline before the handler,
so editing a description to 2001-5000 characters was wrongly rejected with a 400, contradicting
the domain, `features.md`, and the documented PUT behavior in `API.md`.

The validator cannot distinguish a genesis comment from a regular one (it sees only the ids and
content), so it now enforces just the upper bound (5000); the domain applies the exact per-kind
limit — 2000 for a regular comment via `Comment.UpdateContent`, 5000 for genesis via
`UpdateGenesisContent` — and a violation surfaces as a 400 (`ErrorCategory.Validation`). Added
`UpdateCommentCommandValidatorTests` pinning the boundaries (accepts 3000 and 5000, rejects empty
and 5001, requires both ids).

### fix — green CI/security after the Collaboration split, and a fuller local launcher (2026-05-31)

Repaired every red gate left by the Collaboration extraction and brought the local launcher
up to date with the new topology.

- **CI build** — `TodoGrpcServiceTests` now constructs `TodoGrpcService` with its new
  `ITodoRepository` + `IFriendshipService` dependencies (CS7036), and `WorkerLifecycleEventTests`
  uses `Assert.Contains` instead of `Assert.True(.Any())` (xUnit2012 under `-warnaserror`).
- **Docs lint** — fixed an MD004 false-positive in `database.md` where a wrapped bullet began with
  a `+` that markdownlint read as a list marker.
- **Security scan** — added `--no-install-recommends` to the Collaboration Dockerfile `apt-get
  install`, clearing the Trivy IaC HIGH; the CodeQL C# job recovers automatically once the build
  compiles.
- **Launcher** — `Start-Planora-Local.ps1` now starts `collaboration-api` (port 5060, gRPC client of
  Auth 5031 / Todo 5101), derives all stop/cleanup port lists and the shutdown order from a single
  `$ServiceDefs` source of truth (no more hand-maintained duplicates), and gains `-Stop` (tear down
  everything the launcher started, infra/data untouched) and `-Help` (print usage and exit).

**Docs.** Rewrote `README.md` — corrected the license (it is the **Planora Source-Available
License (Study-Only)**, not MIT), fixed the React version (18, not 19), added the per-service local
port map, and slimmed the styling. Documented the launcher's `-Stop`/`-Help` flags and the
Collaboration schema bootstrap in `getting-started.md`.

### perf — frontend render optimization: memoized cards, lighter motion, windowed feed (2026-05-29)

The app felt slow and janky because every task list re-rendered all of its
(very heavy) cards on any state change, several decorative animations ran on an
infinite loop, and `/tasks` mounted the entire task list at once.

- **Memoized `TodoCard`** — `frontend/src/components/todos/todo-card.tsx` now
  exports a `React.memo` wrapper comparing on `todo` identity + `variant`. A card
  only re-renders when its own todo object changes, so completing one task no
  longer re-renders the whole grid. Function props are excluded from the compare
  intentionally (see below).
- **Stable, ref-backed handlers** — dashboard, `/tasks`, and `/tasks/completed`
  read their live lists through refs (`todosRef`, `statsTodosRef`,
  `completedPreviewRef`) inside the card handlers, so a memoized card holding an
  older callback closure still acts on current data. This is what makes ignoring
  callback identity in the memo safe.
- **Trimmed always-on animations** — removed `repeat: Infinity` loops that ran
  regardless of interaction: the collapsed-card category icon now only spins on
  hover, the "delay" badge is static, and the dashboard header's large
  `blur-3xl` decorative blob no longer animates its opacity every frame (a
  full-surface repaint that ran for the page's whole lifetime).
- **Windowed `/tasks` feed** — `frontend/src/app/tasks/page.tsx` keeps the single
  infinite-scroll feed and full client-side filtering, but mounts cards in a
  growing window (initial 24, +24 per `IntersectionObserver` step, 600px
  pre-load) instead of rendering hundreds at once. Data is still fetched in full.

Performance: list interactions no longer re-render every card; `/tasks` initial
mount is bounded to a small window regardless of task count.

### fix — suppress canceled-request noise in the API client (2026-05-29)

Aborted requests are normal control flow (React effects abort in-flight
requests on unmount/dependency change; a newer fetch supersedes an older
one), but the axios response interceptor was logging them via
`console.error`, which raises the Next.js dev error overlay. Pages already
ignored cancellations in their own `catch`, yet the interceptor fired first.

- `frontend/src/lib/api.ts` — the response error handler now short-circuits
  on `axios.isCancel(error)` / `ERR_CANCELED` and rejects silently.
- Genuine no-response network errors are downgraded from `console.error` to
  `console.warn` outside production so backend hot-reload restarts no longer
  trigger the dev overlay; production logging is unchanged.

### perf/security — Start-Planora-Local.ps1 hardening (2026-05-29)

The local launcher no longer embeds secrets in child-process command lines,
builds faster, and gained run-mode flags.

- **Security** — `JWT_SECRET`, `GRPC_SERVICE_KEY`, RabbitMQ credentials and
  the Redis connection string are now loaded only into the launcher's own
  process environment (`Import-EnvFile`) and inherited by `dotnet run` / `npm`
  children. They are no longer interpolated into the `-Command` string, so
  they no longer appear in `Win32_Process` command lines or the transcript.
- **Performance** — backend build is a single `dotnet build Planora.sln`
  invocation (MSBuild compiles shared `BuildingBlocks` once) instead of six
  sequential per-project builds; falls back to per-project if no `.sln`.
- **Flexibility** — new switches `-SkipFrontend`, `-NoBrowser`, `-SkipBuild`
  for backend-only runs, headless runs, and fast no-rebuild restarts.

### T3.6 — IDOR coverage baseline (2026-05-28)

Hand-curated coverage map for every `[Authorize]` endpoint that takes a
resource-identifier path parameter. Pairs each endpoint with the IDOR
protection mechanism (owner check, viewer filter, friend gate, role gate)
and pins which test or invariant verifies it.

- `docs/security-idor-coverage.md` (new) — tables for Auth, Todo,
  Category, Messaging, Realtime services + cross-service gRPC. Each row
  carries one of `pinned by <test>`, `relies on filter`, or `gap`. The
  current pass shows zero `gap` rows; the forward step is auto-generation
  once T2.1's OpenAPI source-of-truth lands.
- `docs/INVARIANTS.md` — new **INV-AZ-8** codifies the contract: any PR
  adding an authorized resource-identifier endpoint must update the
  coverage table and ship an explicit cross-user test, or reviewers
  reject.

### T2.6 cont. — reset-password + profile-update UI specs (2026-05-28)

Two more UI flows on the T2.6 scaffold.

- `e2e/ui/auth-reset-password.ui.spec.ts` — end-to-end forgot → reset →
  login loop. Triggers the reset email via the API path, scrapes the
  Auth-API container logs for the reset token (subject-disambiguated
  from the verification email by matching `Reset` in the log line),
  opens `/auth/reset-password?token=...`, sets a new password, signs in
  with the new password to prove the rotation took effect.
- `e2e/ui/profile-update.ui.spec.ts` — log in, navigate to `/profile`,
  rename via the first-name field, reload to confirm persistence.
- `e2e/ui/_helpers.ts` — adds `requestPasswordResetAndCaptureToken`
  helper (triggers the reset, polls auth logs, returns the token).

### T2.7 — ADR-0006: `force-dynamic` + CSP nonce trade-off documented (2026-05-28)

Closes the open question called out in the master plan ("T2.7: Needs ADR on
CSP nonce trade-off") and the audit finding **P0-FORCE-DYNAMIC**.

- `docs/DECISIONS/0006-force-dynamic-and-csp-nonce.md` — new ADR examining
  the fork in the road (static prerender + nonce is impossible; hash-based
  CSP is the unblock), documenting the **decision to keep** `force-dynamic`
  with the per-request nonce until one of three sunset conditions ships
  (hash-based CSP wiring, a Next.js minor publishing a stable hash manifest
  API, or a vetted community plugin), and rejecting the alternatives
  (`'unsafe-inline'`, per-route opt-in, hand-rolled hashing) with reasons.
- `frontend/src/app/layout.tsx` — comment on the `force-dynamic` line now
  references the ADR so a future contributor sees the rationale at the
  call site, not just in the audit notes.
- P0-FORCE-DYNAMIC is reclassified from "fix immediately" to "open
  contingent on hash-CSP work" in the master plan tracking.

### T4.2 — DB index audit, first pass (2026-05-28)

Targeted index improvements landing as EF entity configurations. Migration
files generate when the next `dotnet ef migrations add` runs against a
development environment with `dotnet ef` available.

- **Outbox partial composite index** — Auth, Category, Messaging, and
  Realtime each gain
  `HasIndex(Status, NextRetryUtc, OccurredOnUtc).HasFilter("Status IN ('Pending', 'Failed')")`
  named `ix_outbox_messages_active`. Directly covers the canonical polling
  predicate in `OutboxRepository<TContext>.GetPendingMessagesAsync`. Excluding
  `Processed`/`DeadLettered` rows keeps the index small even when the table
  accumulates ahead of the cleanup sweep. New INV-COMM-5 pins the convention.
- **Messaging `OutboxMessageConfiguration`** added (was missing — Messaging
  declared the DbSet but never applied an explicit configuration, so EF
  used defaults, leaving the outbox table without any non-PK index). The
  new config matches Auth/Category/Realtime exactly.
- **`MessagingDbContext.OnModelCreating`** now calls
  `ApplyConfigurationsFromAssembly` so future entity configs are picked up
  automatically, matching sister services.
- **`TodoItemComment.AuthorId`** gains a non-unique index. Audit and
  account-deletion cascade scans previously seq-scanned the table once a
  thread accumulated comments.

Deferred to a `dotnet ef`-equipped follow-up: the actual EF migration
files + `ModelSnapshot` updates. Schema-drift guard (INV-FLOW-5) will
prevent silent partial application — operators see the drift and run the
migrator explicitly.

### T2.6 cont. — forgot-password + tasks-page UI specs (2026-05-28)

Two more UI flows on the T2.6 scaffold.

- `e2e/ui/auth-forgot-password.ui.spec.ts` — happy path types a registered
  email, asserts the success banner replaces the form; anti-enumeration
  scenario submits an unknown email and pins that the *same* success
  banner appears (so the UI cannot leak account existence).
- `e2e/ui/tasks-page.ui.spec.ts` — post-login arrival on `/tasks`,
  opens the create-task panel via its aria-labelled toggle, fills the
  title input, then closes the panel. The full create-flow validation
  (category selection) lands in a dedicated follow-up spec so this one
  stays robust against category-UI churn.

### T2.6 start — Playwright browser-rendered E2E scaffold + login flow (2026-05-28)

First slice of master-plan T2.6 (Phase 2): real-browser UI coverage on the
critical user flows. This commit lands the scaffolding plus the **login**
flow; remaining flows (register UI, forgot-password, reset-password,
verify-email-link, todo CRUD, sharing/hidden, profile update, 2FA setup)
land incrementally as separate specs that the same scaffold already
supports.

- `frontend/playwright.config.ts` — splits the suite into two projects.
  `api` keeps the existing request-context tests; `ui` (new) uses Chromium
  with `Desktop Chrome` device emulation. Both projects coexist; selectors
  are file-name based (`*.api.spec.ts` vs `e2e/ui/*.ui.spec.ts`).
- `frontend/e2e/ui/_helpers.ts` — shared setup: `requireFrontendReachable`
  (skips the whole suite if the Next.js URL doesn't respond inside 5 s),
  `registerVerifiedUser` (reuses the API path so UI specs aren't gated on
  re-driving the registration form), `submitLoginForm` (locator helpers
  by visible label).
- `frontend/e2e/ui/auth-login.ui.spec.ts` — two scenarios: happy-path
  login routes to `/tasks` with the user's name visible in the navbar;
  wrong-password leaves the user on `/auth/login` with the error banner
  visible.
- `.github/workflows/e2e.yml` — installs Chromium, builds the frontend
  (production, not dev), starts `next start` on port 3000, waits for
  readiness, runs the whole Playwright suite (both projects), and cleans
  up the frontend PID at the end. Existing API job semantics preserved —
  `E2E_FRONTEND_URL` newly exported.
- `frontend/e2e/README.md` (new) — operator-facing doc on the two-project
  setup, local UI runs, and the skip-friendly design.

The scaffold is intentionally additive: existing CI matrix entries that
do not export `E2E_FRONTEND_URL` continue to run only the `api` project
(UI specs gracefully skip).

### T4.5 — Postgres `idle_in_transaction_session_timeout = 30s` (2026-05-28)

Postgres-side backstop for the per-service Npgsql pool (`Maximum Pool Size=10`,
T4.4). A leaked `DbContext` or a client crash mid-transaction would otherwise
hold a connection open indefinitely, starving the pool and surfacing as
cascading timeouts on unrelated endpoints. 30 s leaves headroom for
legitimate long batches (outbox cleanup, avatar re-encode) while bounding
the worst-case starvation window.

- `docker-compose.yml` — `postgres` service `command` adds
  `-c idle_in_transaction_session_timeout=30000`.
- `deploy/fly/README.md` — new "Postgres tuning" section documents the
  `flyctl postgres config update --idle-in-transaction-session-timeout 30000`
  command for Fly Postgres clusters.

### T4.10 — Motion preferences + hardware-adaptive WebGL background (2026-05-28)

Closes the two scoped halves of master-plan T4.10 that don't require a wider
bundle refactor.

- `frontend/src/components/motion-preferences-provider.tsx` (new) — single
  `MotionConfig reducedMotion="user"` boundary wired into the root layout.
  Every nested `framer-motion` component now respects the OS-level
  `prefers-reduced-motion: reduce` setting automatically: transforms and
  physics collapse, opacity and colour transitions remain, no per-component
  `useReducedMotion()` boilerplate required. The framer-motion `loading.tsx`
  and `celebration.tsx` paths that previously animated transforms on every
  visit now stay still for motion-sensitive users.
- `frontend/src/components/backgrounds/color-bends-layer.tsx` — heuristic
  `useAdaptiveIterations` picks 1 / 2 / 3 fragment-shader iterations based
  on `navigator.hardwareConcurrency` (≤2 / 4–7 / ≥8 cores). Cuts the GPU
  load on low-end mobile in half versus the previous hard-coded `2`, while
  giving desktops a richer effect. Returns 1 during SSR so hydration is
  deterministic; the runtime upgrade happens silently on mount.
- `frontend/src/test/components/color-bends.test.tsx` — parameterised
  smoke test pins that the layer keeps rendering across all three buckets.

Deferred (out of scope for this commit): full dynamic-import of
`framer-motion` per route. Currently every page that imports `motion.*`
ships the framer-motion bundle eagerly. Moving auth pages to a lazy
`<m.div>` + `LazyMotion` setup is a larger refactor tracked in the master
plan.

### T3.5 — Security-stamp expansion + contract test (2026-05-28)

Extends INV-AUTH-4 with a forward-looking rotation policy and pins it with a
source-file contract test (master plan T3.5, Phase 3).

**Why.** Today's INV-AUTH-4 lists the seven shipped rotation points (password
change, password reset, email change confirmation, 2FA disable, revoke-all,
delete, refresh-token reuse detection). Future handlers — role assignment,
admin force-logout, admin lock, admin email override — must also rotate the
stamp, but nothing in CI catches a missing call until a security review picks
it up. The contract test closes that loop.

**What landed.**

- `SecurityStampUsageContractTests` (`tests/Planora.UnitTests/Services/AuthApi/Infrastructure/`):
  source-file scan over every `*CommandHandler.cs` under
  `Services/AuthApi/Planora.Auth.Application/Features/**/Handlers/`. A handler
  whose constructor takes `ISecurityStampService` must also call
  `SetStampAsync` somewhere in its body, or the test fails. Two safety nets:
  a sanity check that at least one injector was scanned (catches regex drift)
  and an explicit anchor type to force the application assembly to load.
- `docs/INVARIANTS.md` — INV-AUTH-4 rewritten to (a) list shipped rotation
  points including INV-AUTH-6's refresh-reuse path, (b) document the
  forward-looking policy with the four expected future rotation commands,
  (c) document the *opt-outs* (profile updates, single-session revocation),
  and (d) reference the new contract test.
- `docs/auth-security.md` — stamp table mirrors the invariant; new
  "Forward-looking rotation policy (T3.5)" subsection enumerates expected
  future rotation points and cites the contract test as the enforcement
  mechanism.

**Scope notes.** No production code changed — the three obvious gap candidates
(`UpdateUserCommandHandler`, `RevokeSessionCommandHandler`) are deliberate
opt-outs and the rationale is now documented. The remaining forward-looking
items (role-change, admin force-logout) ship when their handlers ship.

### T2.5 — Realtime persistence scaffold (2026-05-28)

Adds the durable persistence layer for the Realtime service so notifications
survive pod restarts (master plan T2.5, Phase 2). This commit ships the
**additive scaffold half**:

- `Planora.Realtime.Domain.Entities.Notification` — durable record of every
  consumed `NotificationEvent`, deduplicated by `SourceEventId`.
- `Planora.Realtime.Domain.Entities.NotificationDelivery` — per-recipient
  delivery state (`Pending → Delivered | NotConnected | Failed`) decoupled
  from the parent so reconnect-replay is cheap.
- `Planora.Realtime.Infrastructure.Persistence.RealtimeDbContext` with the two
  entities + `OutboxMessages` table for fan-out integration events.
- EF entity configurations including the `SourceEventId` unique index, the
  per-user index, soft-delete filter, and the canonical
  `OutboxMessage` table shape consistent with sister services.
- `RealtimeDbContextFactory` (design-time) so `dotnet ef` commands resolve
  the context without booting ASP.NET.
- `tools/Planora.Migrator/Program.cs` registers the `realtime` service in the
  one-shot migration runner.
- DI registration is **conditional on `ConnectionStrings:RealtimeDatabase`**
  being present so test and dev hosts without the DB still start clean.
- New INV-DATA-5 in `docs/INVARIANTS.md` codifies the durability contract.

**Deferred (next commit, requires `dotnet ef`).** The initial EF migration
itself (`InitialRealtimeSchema`) and the `NotificationService` rewire that
persists-before-pushing. The connection string in `docker-compose.yml` is
left commented for the same reason — flipping it on without the schema
applied would crash startup.

### Phase 1.5 audit-hotfix wave (2026-05-27)

A four-commit hotfix wave executed against the master plan
(`/root/.claude/plans/staff-melodic-oasis.md`). Closes every P0 and
P1 finding from the audit that did not require architectural refactoring.
Five new invariants added (INV-AUTH-6, INV-AUTH-7, INV-FLOW-5, INV-OBS-5
strengthened, INV-OBS-10 implicit in INV-OBS-5).

**Backend hygiene (wave A — H1, H8, H17, H18).**

- **H1 — JWT `ClockSkew` unified.** Six wiring points (Auth JwtConfiguration, Auth DependencyInjection, Auth TokenService ×2, Messaging Program, Realtime Program) used `TimeSpan.Zero`; the BuildingBlocks consumer extension used `30 s`; Gateway used `5 s`; `SecurityConstants.TokenClockSkewSeconds` was 5 and unused. Every wiring now reads `SecurityConstants.SecurityPolicies.TokenClockSkewSeconds` (set to 30 s, tolerates Fly NTP drift). Pinned tests updated. New INV-AUTH-7.
- **H8 — EF SQL text capture default-off.** `SetDbStatementForText` defaults to `false` to remove PII risk from trace exports; opt in per environment via `OpenTelemetry:Tracing:CaptureDbStatementText=true`. INV-OBS-5 strengthened.
- **H17 — `CacheService.RemoveByPatternAsync` implemented.** Redis `SCAN` + `KeyDeleteAsync` (UNLINK) in 500-key batches with the StackExchangeRedisCache instance-name prefix. Skips replicas, cancellation-aware, no-ops cleanly when no multiplexer is registered.
- **H18 — Idempotent fallback hash MD5 → SHA256.** Truncated to 16 bytes; removes the CA5351 static-analyzer flag with identical determinism.

**CI/CD/infra hygiene (wave B — H5, H7, H16, H21, H22, H23, P2-MIG-002).**

- **H5 — `superfly/flyctl-actions/setup-flyctl@master` SHA-pinned** to `ed8efb33836e8b2096c7fd3ba1c8afe303ebbff1` (v1.6) across all four CD workflow occurrences.
- **H7 — docker-compose healthchecks** switched from aggregate `/health` to `/health/ready`, matching INV-OBS-4 semantics and the Fly manifest probes.
- **H16 — `npm audit --audit-level=high`** (was `moderate`). High-severity transitive CVEs now block CI.
- **H21 — Trivy IaC fail-on-high.** Two-pass scan: first uploads SARIF for the Security tab, second fails the job on HIGH/CRITICAL.
- **H22 — NuGet cache enabled.** `actions/setup-dotnet@v5 cache: true` across `ci.yml`, `security.yml`, `openapi.yml`, `migrations.yml`. `cache-dependency-path` hashes every csproj plus `Directory.Packages.props` + `Directory.Build.props` so the key changes only when the restore graph changes.
- **H23 — CD `/health/live` smoke** added before `/health/ready` poll. 30 s liveness probe distinguishes "gateway crashed" from "backends slow to warm up".
- **P2-MIG-002 — Idempotence marker check.** `migrations.yml` greps for `IF [NOT] EXISTS` in every non-empty generated script; fails if `--idempotent` ever silently produces non-idempotent SQL.

**Frontend P0/P1 (wave C — H9, H10, H11, H13, H14, H15).**

- **H9 — Hydration year mismatch fixed** on the landing page footer (`app/page.tsx`). Already-mounted `mounted` flag reused; matches the existing pattern on auth/login and auth/register.
- **H10 — Rehydrate race closed.** Zustand `onRehydrateStorage` explicitly pins `isAuthenticated=false` when `accessToken` is absent on rehydrate. Prevents a brief render window where guards saw `isAuthenticated=true` before `restoreSession()` resolved.
- **H11 — CSRF 403 retry on the main axios client.** Matches the existing `auth-public.ts` retry semantics. The `_csrfRetry` flag bounds the retry to one round-trip; a second 403 propagates to the caller.
- **H13 — Cross-tab logout via BroadcastChannel.** `clearAuth()` publishes a logout message on the `planora-auth` channel; `SecurityInitializer` subscribes and calls `clearAuth(true)` on receipt (silent flag prevents echo). New `@/lib/auth-broadcast` module owns the channel name.
- **H14 — Traceparent reuse on 401 retry.** `extractTraceId` + `traceparentForExistingTrace` keep the original trace-id intact while a fresh span-id is generated; backend collector groups the retry under the same trace.
- **H15 — CSP additions.** `object-src 'none'; child-src 'none'; worker-src 'self'`. Defence-in-depth against reflected XSS payloads via `<object>`, `<embed>`, or worker spawn.

**Security/integrity (wave D — H2, H3, H4, H6, H19).**

- **H2 — Refresh-token reuse detection.** `RefreshTokenCommandHandler` now treats presentation of a previously-rotated token as a replay attack: every active refresh token on the user is revoked with reason `"Reuse detected — chain invalidated"`, the security stamp is rotated, and Unauthorized is returned. New INV-AUTH-6. Pinned by `RefreshToken_WhenReplayed_InvalidatesChainAndRotatesStamp`.
- **H3 — Todo description max length reconciled** at 2000 chars in both `CreateTodoCommandValidator` and `UpdateTodoCommandValidator`. Matches the existing `varchar(2000)` column; eliminates silent server-side truncation.
- **H4 — Auth API telemetry wrapper removed.** `Services/AuthApi/.../Configuration/OpenTelemetryExtensions.cs` deleted; `Program.cs` calls `AddPlanoraTelemetry(builder.Configuration, "AuthService")` directly, matching every other service. INV-OBS-5 strengthened to explicitly forbid wrappers around the canonical call.
- **H6 — Migrator schema-drift guard.** Refuses to start a migration run when the database has applied migrations absent from the compiled code base. New INV-FLOW-5.
- **H19 — `CODEOWNERS` file** codifies security primitives, observability pipeline, outbox state machine, migrator, CI/CD, deployment manifests, and INVARIANTS as protected paths.

**Deferred (planned for follow-up commits).** H12 (AbortController on data fetches) and H20 (Husky pre-commit hooks) — both wider-scope than the rest of Phase 1.5 and tracked in the master plan.

### PR-9 observability: avatar upload metrics + dead-letter alert (2026-05-26)

Adds two metrics to the shared `PlanoraMetrics` meter and one new alert rule for production monitoring.

**Metrics.**

- `planora.avatar.uploads{outcome}` (Counter) — every avatar upload attempt is tagged with one of six terminal outcomes: `success`, `rejected_size`, `rejected_mime`, `rejected_content`, `not_authenticated`, `user_missing`. The `rejected_*` outcomes double as attack-pattern indicators (size spike → DoS attempt past the 5 MB cap; mime/content spike → polyglot/exploit probing).
- `planora.avatar.variant.bytes{size}` (Histogram) — bytes per emitted WebP variant, partitioned by `small`/`medium`/`large`. p95 spike → ImageSharp encoder regression or a class of source images that resists compression.

**Architecture.** Application layer must not depend on Infrastructure (architecture test pins this). To stay clean, a new `IAvatarMetrics` port lives in `Auth.Application/Common/Interfaces/`; its `AvatarMetrics` implementation in `Auth.Infrastructure/Services/Common/` wraps `PlanoraMetrics`. The handler depends on the port, the architecture test stays green.

**Alert rule** added to `docs/observability.md` § "Suggested Alerts":

```yaml
- alert: PlanoraAvatarUploadAbuse
  expr: sum(rate(planora_avatar_uploads_total{outcome=~"rejected_size|rejected_mime|rejected_content"}[5m])) > 1
  for: 5m
  severity: warning
```

Also added `PlanoraOutboxDeadLetter` (per the operations runbook gap flagged in the original audit — `dead_lettered` should page before users notice).

**Tests** (+4, full = 717 green):

- `UploadAvatar_ShouldRecordOutcomeMetric_ForEveryTerminalPath` — asserts `RecordOutcome("success")` plus three `RecordVariantBytes` calls on the happy path.
- `UploadAvatar_ShouldMapProcessorErrorCodeToMetricOutcome` (Theory, 3 cases) — INVALID_FILE_SIZE → rejected_size, UNSUPPORTED_MEDIA_TYPE → rejected_mime, INVALID_IMAGE_CONTENT → rejected_content.

**Docs.**

- `docs/observability.md` § "Built-in Custom Metrics" — new rows for both instruments with cardinality notes and use-case guidance.
- `docs/observability.md` § "Suggested Alerts" — new `PlanoraAvatarUploadAbuse` and `PlanoraOutboxDeadLetter` rules.
- `CHANGELOG.md`: this entry.

Refs: `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Observability/PlanoraMetrics.cs`, `Services/AuthApi/Planora.Auth.Application/Common/Interfaces/IAvatarMetrics.cs`, `Services/AuthApi/Planora.Auth.Infrastructure/Services/Common/AvatarMetrics.cs`, `docs/observability.md`.

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
