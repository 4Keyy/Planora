# Features

This reference describes confirmed Planora behavior and points each feature back to implementation files.

## Authentication And Session Lifecycle

### Purpose

Register users, log in, maintain browser sessions, rotate refresh tokens, log out, and restore sessions after page reload.

### User Flow

1. User fetches CSRF token.
2. User registers or logs in.
3. Auth API returns an access token in JSON and sets an httpOnly refresh cookie.
4. Frontend stores access token in memory and user metadata in session storage.
5. On `401`, frontend refreshes once using the cookie, rotates the refresh token, and retries the request.
6. Logout revokes the server-side refresh token when possible and always deletes the cookie.

### Implementation

- `Services/AuthApi/Planora.Auth.Api/Controllers/AuthenticationController.cs`
- `Services/AuthApi/Planora.Auth.Application/Features/Authentication`
- `frontend/src/lib/auth-public.ts`
- `frontend/src/lib/api.ts`
- `frontend/src/store/auth.ts`
- `docs/DECISIONS/0002-http-only-refresh-cookies.md`

### Key Rules

| Rule | Source |
|---|---|
| Refresh token is not returned in login/register/refresh JSON. | `AuthenticationController.cs` |
| Refresh token cookie path is `/auth/api/v1/auth`. | `AuthenticationController.cs` |
| Persistent refresh cookie is used only when `rememberMe` is true. | `AuthenticationController.Login`, `RefreshToken` |
| Access token is not persisted by the frontend store. | `frontend/src/store/auth.ts` |
| Refresh uses a separate public auth client to avoid interceptor recursion. | `frontend/src/lib/auth-public.ts` |

### Edge Cases

- Missing refresh cookie returns `204 No Content` so silent restore can fail without a browser console error.
- Invalid refresh clears the cookie.
- CSRF is still required for state-changing anonymous auth endpoints.

## CSRF Protection

### Purpose

Protect browser state-changing requests that rely on cookies.

### Implementation

- `GET /auth/api/v1/auth/csrf-token` in `AuthenticationController.cs`
- `BuildingBlocks/Planora.BuildingBlocks.Infrastructure/Middleware/CsrfProtectionMiddleware.cs`
- `frontend/src/lib/csrf.ts`

### Key Rules

- CSRF validation applies to `POST`, `PUT`, `PATCH`, and `DELETE`.
- gRPC requests are excluded.
- The middleware compares `X-CSRF-Token` header and `XSRF-TOKEN` cookie with constant-time comparison.

## Profile, Security, And 2FA

### Purpose

Let users manage profile data, password/email changes, email verification, sessions, login history, and TOTP-based 2FA.

### Implementation

- `Services/AuthApi/Planora.Auth.Api/Controllers/UsersController.cs`
- `Services/AuthApi/Planora.Auth.Application/Features/Users`
- `Services/AuthApi/Planora.Auth.Infrastructure/Services/Authentication/PasswordValidator.cs`
- `frontend/src/app/profile/page.tsx`

### Key Rules

| Area | Behavior |
|---|---|
| Profile update | `firstName` and `lastName` required, max 100; profile picture URL max 500 and must be absolute HTTP/HTTPS if present. |
| Avatar upload | `POST /me/avatar` accepts JPEG/PNG/WEBP up to 5 MB, 64×64..4096×4096. Server validates MIME, magic bytes, and dimensions; re-encodes to WebP (lossy q=85); strips EXIF/ICC/XMP; emits three variants (64/128/512). URLs are content-addressed `/avatars/{userId}/{hash}/{size}.webp` with `Cache-Control: public, max-age=31536000, immutable`. Each upload prunes the user's prior hash directory. `User.ProfilePictureUrl` holds the medium (128) variant. |
| Password strength | min 8, max 128, uppercase, lowercase, digit, special char; also weak/sequential/repeating checks in infrastructure. |
| Email verification | registration/change-email create a 24-hour token; `GET /auth/api/v1/users/verify-email?token=...` confirms it; profile `POST /me/verify-email` sends a fresh link for the signed-in user. `Email__Provider=GmailSmtp` sends real Gmail messages; default `Log` provider writes links to Auth API logs. User DTOs expose `isEmailVerified` and `emailVerifiedAt`. |
| Compromised password check | HIBP k-anonymity lookup is enabled by config default in `PasswordValidator`; lookup failure logs and does not block. |
| 2FA enable | returns setup data (secret + QR code URL). |
| 2FA confirm | requires a 6-digit TOTP code; on success returns 10 single-use recovery codes formatted `XXXXX-XXXXX`. Codes are hashed with BCrypt before storage and each is consumed once on use. A new set is generated on every re-confirmation. |
| 2FA login | TOTP code is tried first; if it fails, a recovery code is accepted as a fallback. |
| TOTP secret | encrypted at rest with ASP.NET Core Data Protection. |
| Password change / reset | invalidates all existing access tokens via per-user security stamp in Redis. |
| Admin users | admin-only user list/statistics/detail endpoints exist. |

### Frontend Behavior

- The profile route presents account work as a single responsive profile center: a summary header, horizontal-on-mobile/side-on-desktop section navigation, and animated panels for identity, security, sessions, login history, friends, and admin tools.
- Profile panels use calm opacity/position transitions through `framer-motion` and keep existing Auth API calls for profile update, password/email changes, email verification, 2FA setup, session revocation, friend requests, and admin user lookup.
- Character-limited profile fields use the shared input counter and warning styling used elsewhere in the frontend.

## Friendships

### Purpose

Establish social relationships required for task sharing and friend-scoped task visibility.

### Implementation

- `Services/AuthApi/Planora.Auth.Api/Controllers/FriendshipsController.cs`
- `Services/AuthApi/Planora.Auth.Application/Features/Friendships`
- `Services/AuthApi/Planora.Auth.Domain/Entities/Friendship.cs`
- `GrpcContracts/Protos/auth.proto`
- `frontend/src/app/profile/page.tsx`
- `frontend/src/hooks/use-friends.ts`

### Key Rules

- Friend requests can be sent by `friendId` or by email.
- Email invite response is intentionally generic: "If that email can receive friend requests..."
- Incoming/outgoing requests are controlled with `incoming=true/false`.
- Internal friend-id and are-friends checks return safe fallback values on exceptions.
- Gateway exposes both `/auth/api/v1/friendships*` and legacy `/friendships*`.

## Categories

### Purpose

Organize todos with user-owned labels that carry color, icon, and display order.

### Implementation

- `Services/CategoryApi/Planora.Category.Api/Controllers/CategoriesController.cs`
- `Services/CategoryApi/Planora.Category.Application/Features/Categories`
- `Services/CategoryApi/Planora.Category.Domain/Entities/Category.cs`
- `Services/CategoryApi/Planora.Category.Domain/Enums/CategoryColors.cs`
- `frontend/src/app/categories/page.tsx`

### Key Rules

| Field | Rule |
|---|---|
| `name` | required, max 50 |
| `description` | optional, max 500 |
| `color` | optional; must be a predefined color or `#` plus 6 alphanumeric characters |
| `icon` | optional string |
| `displayOrder` | defaults to 0 |

### Edge Cases

- Delete returns `404` for `CATEGORY_NOT_FOUND`.
- Delete returns `403` for forbidden access.
- Category deletion emits integration behavior consumed by Todo; see `Services/TodoApi/Planora.Todo.Application/Features/Todos/Events/CategoryDeletedEventHandler.cs`.

### Frontend Behavior

- Editing an existing category is **quick-save**: there are no Save/Cancel buttons. Changing the name, description, color (color picker), or icon persists automatically. The debounced `useAutosave` hook (`frontend/src/hooks/use-autosave.ts`) coalesces bursts (e.g. dragging the color picker) into a single `PUT`, updates the grid optimistically, and a `AutosaveIndicator` reports `Saving… / All changes saved / Couldn’t save`.
- An empty name is never persisted (a category's only required field); the modal shows an inline "Enter a name to save your changes" hint and skips the save until a name is present.
- Pending edits are flushed when the modal closes (X / `Escape` / backdrop / `Done`), so a change made inside the debounce window is never lost.
- **Creating** a category is the one exception that keeps an explicit `Create category` button: nothing exists to autosave yet, and auto-creating on keystroke would leave half-typed categories behind. There is no Cancel button — closing the modal simply discards the draft.

## Todos

### Purpose

Create, update, delete, complete, filter, share, hide, and categorize tasks.

### Implementation

- `Services/TodoApi/Planora.Todo.Api/Controllers/TodosController.cs`
- `Services/TodoApi/Planora.Todo.Application/Features/Todos`
- `Services/TodoApi/Planora.Todo.Domain/Entities/TodoItem.cs`
- `Services/TodoApi/Planora.Todo.Domain/Enums`
- `frontend/src/app/todos/page.tsx`
- `frontend/src/app/todos/completed/page.tsx`

### Key Rules

| Area | Behavior |
|---|---|
| Title | required on create, max 200 |
| Description | optional, max 2000 — enforced consistently by the create/update validators and the EF `Description` column (`HasMaxLength(2000)`) |
| Status | backend statuses are `Todo`, `InProgress`, `Done`; parser accepts legacy aliases such as `pending` and `completed` |
| Priority | `VeryLow`, `Low`, `Medium`, `High`, `Urgent`; EF stores integer value |
| Expected/due dates | expected date cannot be after due date when both are present |
| Category | Todo validates category ownership through Category service |
| Sharing | direct `sharedWithUserIds` must be accepted friends; the task form exposes public all-friends visibility inside `Share With`; `IsPublic` is independent from direct shares and makes the task visible to all accepted friends |
| Non-owner updates | friend-visible viewer can only change status |
| Visibility persistence | `UpdateTodoCommandHandler` loads the entity via `GetByIdWithIncludesTrackedAsync` (with EF Core change tracking) so that changes to `IsPublic` and `SharedWith` collection additions/removals are correctly persisted — tracked loading generates the right INSERT/DELETE DML for the `TodoItemShare` collection, whereas a detached `DbSet.Update()` call would silently emit UPDATE-only SQL against non-existent rows |

### Subtasks

A **subtask** is a child `TodoItem` (self-referencing `ParentTodoId`) — a part of its parent
task, stored in the parent's tree. Subtasks exist **only inside a task's branch** (the edit modal):
they never appear on the tasks page, the completed page, the dashboard grid, or any list.

A subtask is **a regular event in the branch timeline**, not a separate panel. It is authored
exactly like the task description — through the compose box's **"+" menu → "Subtask"**, which
switches the same input field into subtask mode (plain Enter adds the step; creating a subtask
**closes the composer**, returning to plain-message mode). Each subtask **forks off the main rail
into its own little sub-branch**: the card and its completion reply sit **offset to the side**,
joined back to the rail by connectors. **There is no creation notification at all** — a subtask
never announces that it was created.

- the **card** (task-like, same **slide-from-right red delete panel**), offset onto the sub-branch.
  Its **completion toggle is the subtask's ONLY marker**, sitting on the sub-branch at the card's
  **vertical centre** (not at the top); a state-tinted fork reaches in from the main rail;
- a subtask is **taken into work and completed through that one marker — exactly like a normal
  task, with no separate "lightning" button.** The first click on an idle subtask **takes it into
  work** (per-user join; hovering an idle marker hints this with a small amber dot, not a bolt); a
  second click — now that you're working — **completes** it; on a done subtask the marker reopens
  it. Taking into work is **per-user**: each person joins/leaves independently (server-side worker
  rows), so one person working never flips it "in work" for another;
- the card carries a **footer byline**: the subtask author's avatar + name on the left (live
  identity resolved from Auth on read; the creator's own JWT claims on create), and the work
  controls on the right — a muted **Reply** action (quotes the subtask in the composer), the
  anonymous **"N working"** presence pill (amber + pulsing dot; it **never names anyone**; the
  viewer's own membership reads "Working" / "You +N", and **for the viewer who is working the same
  pill crossfades to a red "Leave" on hover** — there is no separate exit button), and an explicit
  **"Take into work"** pill-button (white → ink on hover, `Play` icon) shown whenever the viewer
  is not working the step — the labelled path beside the marker's click-to-take behaviour;
- when done, a **completion reply** — *another reply on the same sub-branch, with **no rail icon***
  — joined by a soft "└" elbow: "**{Name}** completed sub task · HH:MM" (a nameless "Sub task
  completed" shows instantly on optimistic completion, then the name fills in when the folded
  system comment lands).

Subtask **system notifications never get their own icons on the rail** — the only marker the
sub-branch carries is the subtask's own completion toggle.

| Aspect | Rule |
|---|---|
| Storage | child `TodoItem` with `ParentTodoId`; one level deep (a subtask cannot have subtasks) |
| Creation | **any branch participant** can add one — the owner, or a friend with access to a shared/public parent (`CreateSubtaskCommandHandler` mirrors the `GET …/subtasks` access check, so collaborators contribute steps, not just the author). The child is **always owned by the parent owner** regardless of who created it, so rename/delete stay owner-only and it inherits the parent's category/visibility/sharing |
| Category | always inherited from the parent (never set independently) |
| Visibility | public exactly when the parent is public; inherits the parent's shared audience. A parent's category/visibility/sharing change **propagates** to its subtasks |
| Dates | none — a subtask never has a due or expected date |
| Priority | **none in the UX** — a subtask is just a checkable titled step; no priority is shown, chosen, or edited. (The entity still has a priority column, defaulted server-side; it is never surfaced.) |
| Title length | a subtask's whole content lives in its title, so it allows **up to 1500 characters** (regular-task titles stay ≤200). Enforced by `CreateSubtaskCommandValidator` (1500), `UpdateTodoCommandValidator` (1500, shared with subtask renames), the widened `TodoItems.Title` `varchar(1500)` column, and the frontend `SUBTASK_MAX = 1500` (create textarea + inline edit textarea both wrap/grow) |
| Editing | the title is **owner-only** (inline edit in the card; double-click the title or the pencil). Non-owners cannot edit |
| Status / completion | **Completion is global** — anyone with access marks it done/reopens it for everyone (entity status). Stays in the branch after completion (shown done with its completion reply, not removed) |
| In-work (per-user) | **"In work" is per-user, not global** — each participant (the **owner included**) joins/leaves a subtask independently via worker rows (`joinTodo`/`leaveTodo`; subtasks have unlimited capacity and the owner-always-worker rule is relaxed for subtasks). If one user picks it up it is **not** "in work" for another; everyone just sees an anonymous **"N working"** count (`workerCount`), and each viewer's own toggle reflects their `isWorking`. No "started working" notification is emitted for subtasks |
| Lists | excluded from `GetUserTodos`/`GetPublicTodos`/`GetTodosByCategory` (`ParentTodoId == null` filter) |
| Statistics | a **completed** subtask counts toward the **weekly dashboard stat** — the dashboard stats fetch passes `includeSubtasks=true`; active subtasks are filtered out of the active counter and subtasks are never rendered as cards |
| Branch messages | **Creating a subtask emits no event**, and **taking one into work emits no event** (JoinTodo/LeaveTodo skip the activity event for subtasks). **Completing** a subtask still posts `TaskActivityIntegrationEvent` (`SubtaskCompleted`, `Detail` = title) to the **parent's** branch, but **no subtask system comment is ever rendered as a standalone rail node** — `buildFeed` hides *every* "added a subtask: …" / "completed a subtask: …" comment (matched or not, so legacy/renamed ones never reappear) and folds the matched completion into the icon-less reply. The "N working" badge is derived from the subtask's live `workerCount` (polled), so all viewers see it. A subtask has no branch of its own |
| Rendering | a subtask shows only its title (no description), rendered **non-bold** so it reads as a plain branch step, lighter than the Author's Note. A long title **wraps** (the card is flexible-height) rather than being truncated. The subtask forks off the main rail onto a **sub-branch**; its completion toggle is the **only** rail marker; the completion attribution is an **icon-less reply** on the sub-branch (no creation notification at all). Below the title sits the **footer byline**: author avatar + name (live from Auth — `authorName`/`authorAvatarUrl` on the subtask DTO) on the left; Reply, the "N working" pill (hover→Leave for the viewer working) and the "Take into work" button on the right |
| Lifecycle | deleting a task soft-deletes its whole subtree. Deleting a **single subtask** also removes the announcement comments it left in the parent's branch — TodoApi emits `SubtaskDeletedIntegrationEvent(parentTaskId, subtaskId, actor, title)` (instead of `TaskDeletedIntegrationEvent`, which would wipe a whole branch); Collaboration's `SubtaskDeletedEventConsumer` soft-deletes the parent-branch system comments whose content ends with `added a subtask: {title}` / `completed a subtask: {title}`. The client also removes them optimistically (suppressing their ids so polling can't re-add them before the cascade lands) |

Backend: `POST/GET /todos/api/v1/todos/{id}/subtasks` (owner **or friend-with-access** creates, child owned by the parent owner; owner/friend lists),
`CreateSubtaskCommand`, `GetSubtasksQuery`; `TodoItem.CreateSubtask` / `SyncInheritedFromParent`;
migration `AddSubtaskParentTodoId`. Frontend: created from the branch "+" menu ("Subtask") via the
shared compose field, and rendered on the rail by `edit-todo-modal/branch-feed.tsx` as a sub-branch
(`SubtaskCard` + the icon-less `SubtaskCompletionReply`; `buildFeed` hides all subtask system
comments and folds the matched completion into `meta`) — completion is global (everyone), **taking
into work is per-user** (worker rows via `joinTodo`/`leaveTodo`, shown as an anonymous "N working"
count to all), inline title edit + delete are owner-only, and there is no priority control.

### Branch Replies

Any branch message can be answered with a **reply** that quotes its target. Replies work on
**plain messages, on subtasks, and on replies themselves** (chains are just replies whose target
is itself a reply — no nesting limit, no separate endpoint). System events and the Author's Note
cannot be replied to.

**Composing.** Every message row shows a **Reply** action on hover (next to edit/delete; available
to anyone with branch access), and every subtask card carries a **Reply** action in its footer.
Starting a reply drops any special compose mode and slides a **"Replying to" chip** above the
compose box (height-animated, nothing jumps): quoted author's avatar + name, a one-line excerpt,
an amber `SUBTASK` badge when quoting a subtask, and an ✕ to cancel — `Esc` cancels the reply
first, then (pressed again) the compose mode, without closing the modal.

**Rendering — nested sub-branches, not a flat stream.** Replies do **not** sit inline on the main
rail. Each reply is grouped into a **sub-branch (thread) hanging beneath its root** — the top-level
message or the subtask it ultimately descends from — rendered as a tidy indented column with its
own sub-rail, branched off the main rail by a soft elbow and with the reply avatars sitting on the
sub-rail exactly as messages sit on the main rail (`ReplyThread`, geometry constants
`THREAD_CONTENT` / `THREAD_RAIL_X` / `THREAD_AVATAR`). The model is **two levels, flat**: every
reply in a root's chain lands in that one thread (no ever-deepening indentation), and chain depth
is conveyed by quotes instead. `buildFeed` → `resolveThreads` walks each reply's chain up to its
root to group it; a reply whose root is on an unloaded earlier page falls back to a standalone
main-rail row so it is never lost, and rejoins its thread once earlier messages load.

**Quote visibility follows the nesting:**

- a **direct reply to a message or subtask** shows **no quote** — its position in that root's
  sub-branch already says what it answers;
- a **reply to another reply** shows the compact **quote block** of the reply it answers (the
  `ReplyQuote` chip): colour-keyed accent bar (violet for a quoted message, amber for a quoted
  subtask, grey when deleted), the quoted author's avatar + name and a one-line excerpt. Clicking it
  **smooth-scrolls the branch to that reply** and pulses it (`reply_flash` keyframe); targets on
  unloaded pages are a quiet no-op, deleted targets render muted with a `DELETED` badge and are
  not clickable.

| Aspect | Rule |
|---|---|
| Layout | reply nests in its root's sub-branch (message/subtask); reply-to-reply joins the **same** sub-branch as the reply it answers (flat, one indentation level) — never on the main rail (except the unresolved-root fallback) |
| Quote | shown **only** when answering another reply; a direct reply to a root shows none (nesting conveys it). Resolved per-reply by `resolveThreads` (`showQuote`) |
| Targets | `comment` (a user comment **or another reply** in the same branch) and `subtask` (a child of this exact task). Never system events or the genesis note |
| Snapshot | captured **server-side** at write time (`ReplyToAuthorId/Name`, `ReplyToPreview` ≤ 300 chars, newlines flattened); client-supplied preview text is never accepted |
| Live refresh | quoted author identity is re-resolved from Auth on every read (rename-safe); for **comment** targets the preview is re-read from the live target in one batched query per page (edits propagate) |
| Target deletion | the reply **survives** with its snapshot. Comment targets: detected live on read (missing row ⇒ `replyToDeleted`). Subtask targets: `SubtaskDeletedEventConsumer` flags quoting replies via `MarkSubtaskReplyTargetsDeletedAsync` — without touching `UpdatedAt`, so the cascade never fakes an "edited" badge |
| Security | the target is validated against the same branch (cross-branch ids ⇒ `404`, same as missing — no probing oracle); subtask targets are verified by Todo over `GetSubtaskBrief` gRPC (fail-closed `503` when Todo is down) |
| Notifications | the quoted author receives a dedicated `ReplyAdded` ("… replied to your message/subtask"); every other participant gets the usual `CommentAdded` |

Backend: `Comment.CreateReply` / `TruncatePreview` / `MarkReplyTargetDeleted` (Collaboration
domain), `AddCommentCommand(ReplyToType, ReplyToId)` + handler target resolution,
`GetCommentsQueryHandler` live-quote enrichment, `CommentRepository.GetLiveByIdsAsync` /
`MarkSubtaskReplyTargetsDeletedAsync`, `TodoService.GetSubtaskBrief` gRPC. Frontend:
`branch-feed.tsx` (`resolveThreads` root grouping, `ReplyThread` nested sub-branch, `ReplyDraft`
composer chip, `ReplyQuote` block, `jumpToQuoted` scroll-and-pulse), `addComment(todoId, content,
replyTo?)` in `lib/api.ts`, reply fields on `TodoComment`.

The reply sub-branch is visibly **forked off its parent** (`ReplyThread`, `THREAD_*` geometry).
Under a **message** it indents onto its own sub-rail and connects to the main rail by an elbow;
under a **subtask** it sits on the subtask's **own** sub-branch axis and inherits its line colour
(green/amber/grey), so the subtask branch flows straight into the reply avatars. The rail is drawn
per row and **ends at the last reply's avatar** — never a dangling segment below it.

### Completed-task actions (Restore & Duplicate)

Once a task is **completed**, opening its branch and pressing **"+"** swaps the compose menu's
active-task actions (description / subtask / take-into-work / complete) for the two completed-task
actions, so a done task is never a dead end:

- **Restore task** — reopens it (the same status flip as un-completing), moving it back to active.
  **Author-only**: returning a completed task to work belongs to its creator. The Restore action is
  hidden for non-owners (`isOwner && showCompleteAction` in `BranchFeed`), and every reopen path is
  guarded — a non-owner who presses the completion button on a done task gets a warning toast
  ("Only the author can reopen this task — duplicate it to work on your own copy.") instead of the
  flip. Server-side, the owner's `status → todo` and the viewer's `completedByViewer → false`
  reopen are both rejected for non-owners (the latter throws `ForbiddenException` in
  `SetViewerPreferenceCommandHandler`).
- **Duplicate task** — creates a **fresh active copy** owned by the caller. **Open to any
  participant** (the owner, or a friend who can see a public/shared task) — this is the non-owner's
  alternative to reopening. The server (`POST /todos/{id}/duplicate`, `DuplicateTodoCommand`) copies
  the content — title, description, priority, category, visibility, shared audience, tags, required
  workers — but **not** the dates, the completion state, or the **branch** (comments/subtasks), and
  emits the normal `TaskCreatedIntegrationEvent` so the new branch's "created" comment and all
  participant notifications fire. The copy is created under the duplicator's account and lands in
  their active list (the page refreshes; a "Task duplicated" toast confirms).

| Aspect | Rule |
|---|---|
| Restore availability | surfaced only when `isCompleted` **and** the viewer is the owner; non-owner reopen is blocked everywhere (menu hidden + completion-button toast + server guard) |
| Duplicate availability | surfaced when `isCompleted` to **any participant**; `onDuplicate` is wired un-gated by every page |
| Copied by Duplicate | title, description, priority, category (re-validated against the duplicator; dropped if not theirs/deleted), `isPublic`, shared audience (re-validated vs. the duplicator's current friends), tags, `requiredWorkers` |
| NOT copied | `dueDate`/`expectedDate`, completion state (copy starts active), the branch (comments & subtasks) |
| Security | duplicate access mirrors the view rule (owner, or friend who can see a public/shared task), re-validated server-side; a subtask cannot be duplicated (no standalone existence); reopen is author-only |
| Notifications | full support — the copy emits `TaskCreated` exactly like a normal create (new branch system comment + participant notifications) |

Backend: `DuplicateTodoCommand` + handler, `POST /todos/api/v1/todos/{id}/duplicate`. Frontend:
`duplicateTodo(id)` in `lib/api.ts`, `onDuplicate` through `EditTodoModal` → `BranchFeed` (the
completed-state "+" menu's Restore + Duplicate `MenuActionItem`s), wired in the tasks, completed,
and dashboard pages.

### Branch on its own page

The task branch opens in-place as a modal on a plain card click, but it also has a **standalone
page** at `/branch/{id}` (`app/branch/[id]`, behind the shared `AuthGuard` + `Navbar` layout, with
the **same left/right gutters** as the rest of the app — `max-w-[1600px]` + `px-4/5/6`).

The editor body is **shared, not duplicated**: `modal.tsx` exports `TodoEditor` (title, the meta
controls — priority / due date / category / visibility — and the branch), and `EditTodoModal` is
now just the dialog chrome wrapping `<TodoEditor variant="modal">`. The page renders
`<TodoEditor variant="page">` full-width inside a page card. So the page is the **full editor** —
every control the modal has (inline title edit, priority, due date, category picker,
visibility/sharing, owner autosave, the In Progress pill with hover → Leave, the "+" menu) plus the
complete branch — not a read-only view.

The two variants share the title editor, In Progress pill and branch but lay them out differently:

- **Modal** — single column: chrome bar (Task Branch label · Open page · pill · close), title,
  the horizontal `InlineTokenStrip`, the branch.
- **Page** — wide two-column: a header row carrying the `Task Branch` back-link, the editable title
  and the In Progress pill on the right; below it a **compact left meta sidebar** (`PageMetaPanel`,
  ~389px) and the branch filling the rest. The sidebar stacks priority and category as full-width
  rows that open their popovers, and renders **two controls always-open inline** so the wide space
  is useful at a glance: the **visibility panel** (`VisibilityPanel`, extracted from
  `VisibilityPopover` — private/public + the friend access list, no dropdown) and the **due-date
  calendar** (`DateCalendar`, headless, quick-picks hidden via `hideQuickPicks` — just the grid).
  Escape closes the modal but is a no-op (beyond popover/title) on the page.

**Calendars are click-to-open everywhere except this page.** The branch page sidebar is the only
place the calendar stays open; the modal's date token opens a popover, and the create panel uses a
collapsible inline calendar (hidden until clicked) — so the calendar is never shown unprompted
except on the dedicated branch page.

The editor seeds its local fields from the task **once per task** (`todo.id`), not on every prop
update — so on the page (where the parent feeds the saved task back after autosave) the controls
never "snap back". This matters because a friends-visibility task with no one selected persists as
`isPublic:false, sharedWith:[]`, indistinguishable from private; re-seeding on every update used to
flip the selection. The shared `Popover` animates open **and** close (framer-motion).

The page owns the task + category data and wires every editor action against the API: owner
autosave (`PUT` preserving status), viewer category preference, take/leave work, complete/restore,
and duplicate (which navigates to the new copy's page). A missing/forbidden task shows a friendly
"not found" with a link back to `/tasks` (access is enforced server-side by `GetTodoById`).

Two ways to reach it: **Ctrl/⌘-click a task card** opens the page in a **new tab** (a plain click
still opens the modal), and the modal's top chrome has a grey **"Open page"** button (same row as
the In Progress pill) that opens it in a new tab. Both compute the URL from the task id;
`TodoCard` handles the modifier-click, `TodoEditor` (modal variant) renders the button.

### Frontend Behavior

- **Branch composer conventions** (`edit-todo-modal/branch-feed.tsx`): **Enter** sends/adds in every
  mode — plain message, subtask, and description; **Shift+Enter** inserts a newline. The same
  Enter-saves / Shift+Enter-newline convention applies to editing a message and to the Author's
  Note (description) editor. Switching the compose mode from the "+" menu (to subtask/description
  and back) **keeps the typed draft** instead of clearing it, so a message can be promoted into a
  description or subtask without retyping. Double-clicking a subtask title edits it **in place** —
  the view `<span>` and edit `<textarea>` share an identical box model, so the field fades in with
  no layout jump.
- Active todo page loads active tasks in pages of 200.
- Completed preview uses page size 20.
- Sorting groups active tasks by date urgency and priority in `frontend/src/utils/sort-tasks.ts`.
- Category filter state is stored in local storage by `frontend/src/utils/category-filter.ts`, scoped per user under the key `todos-cat-filter:<userId>`. Each account's filter survives a hard refresh (including Ctrl+F5), and switching accounts never leaks one user's filter onto another. The `/tasks` and `/tasks/completed` pages re-read the filter whenever the active user changes; an unknown/logged-out user resolves to an empty filter.
- Keyboard shortcuts confirmed in `frontend/src/app/todos/page.tsx`: `F` opens category filter and `C` opens create panel when focus is not inside form controls.
- Dashboard also keeps the `C` create-panel shortcut. The collapsed panel header shows "New task" as its title and a `press C to open` `<kbd>` hint in the subtitle so the shortcut is self-documenting without a separate dismissible banner.
- Pressing `Escape` inside the create task panel returns it to the collapsed create action with a calm layout fade instead of leaving an empty white panel or adding bounce.
- `frontend/src/components/todos/todo-card.tsx` runs a short local completion/reopen animation before calling the page-level status update, so list refreshes happen after the card has visually acknowledged the action.
- Hidden/collapsed task cards blur the category pill until hover/focus, keeping category filtering visible without exposing it at rest.
- Urgent, overdue, and due-today private cards use a red border only; shared/public urgent cards keep the blue shared frame and use a red left border wall. The previous filled left urgency stripe is intentionally absent.
- The create task panel keeps title and description as labeled light panels, followed by full-width priority, category, due date, and `Share With` sections. The due-date field uses the project's own inline `DateCalendar` (with its Today/Tomorrow/+3/Next-week quick-picks), not a native `<input type="date">`. Character-limited fields show `current/max` counters at the panel edge and switch to red warning state from 80% of the limit. Friend visibility stays inside a neutral `Share With` selector where all-friends visibility and direct friend selection are mutually exclusive, and the panel does not expose a tags field or a duplicate property summary.
- On the dashboard, the create panel opens with a softened layout transition and staged field reveal. Its primary plus icon becomes a rotated close action while the panel is open, so the same control pattern can open and close the draft surface.
- Toast notifications render on the toast z-index layer and start below the fixed navbar, so completion/update feedback is not hidden behind the header.
- The floating navbar quick-creates tasks (title only, private, no category) and dispatches a `planora:task-created` custom DOM event on success, carrying the freshly created task on `event.detail.todo` (see `frontend/src/lib/events.ts`). Both the dashboard and todos pages listen for this event: they insert the new task into the list immediately (optimistically) and then reconcile with a silent background refetch, so a new task appears instantly instead of after the list reloads. The dashboard also resets pagination to page 1.
- The navbar is responsive (`frontend/src/components/layout/navbar.tsx`). On pointer devices (`sm` and up) it is the hover-expanding floating pill. Below `sm`, where hover never fires, phones get a dedicated touch bar with a tap-to-open sheet menu — quick-add task input, navigation tabs with an active indicator, and account actions (Profile / Sign out) — reusing the same state and handlers as the pill. Both variants clear the iPhone status bar / Dynamic Island via `env(safe-area-inset-top)` (enabled by `viewport-fit=cover` in `app/layout.tsx`).
- Task list updates feel instant because mutation-triggered refetches run in "silent" mode (`fetchActiveTodos`/`fetchTodos` accept `{ silent }`): creating a task inserts it from the POST response right away, and create/reopen refreshes no longer flash the skeleton grid over existing cards. The first full page load still shows skeletons; only background reconciliation is silent.
- In the Task Branch edit modal, the title heading and its inline edit field share the exact same box model (padding, negative margin, border radius and font metrics), so clicking the title to rename it never shifts the heading sideways or changes its size — it simply fades from the hover background into an editable field.
- The Task Branch edit modal (`frontend/src/components/todos/edit-todo-modal`) is **quick-save** with no Save/Cancel buttons: editing the title, priority, due date, category, or visibility/sharing autosaves via the debounced `useAutosave` hook. Owners persist the full task payload; a shared viewer who can manage their own category autosaves only their private category preference. The description ("Author's Note" in the branch) keeps its own explicit editor and is intentionally excluded from the autosave equality check so it is never written twice. There is **no footer panel** — no autosave-status indicator and no `Done` button; the modal closes via the header **✕**, the backdrop, or `Escape`, and a pending edit is flushed on close/unmount. Save failures are toasted once; the autosave retries on the next edit.
- When the user removes a category during task edit, `applyCategoryPatch` (`frontend/src/utils/todo-utils.ts`) zeroes all four category fields (`categoryId`, `categoryName`, `categoryColor`, `categoryIcon`) in local state after the PUT — necessary because the backend treats `categoryId: null` as a no-op and echoes back the old values.
- Todo, dashboard, and completed-task pages enrich author names for public friend tasks as well as direct shared tasks.

## Task Workers ("В работе")

### Purpose

Allow friends to claim participation slots on public or shared tasks. The task owner sets an optional `RequiredWorkers` capacity. Workers join voluntarily and can leave at any time.

### Implementation

- `Services/TodoApi/Planora.Todo.Domain/Entities/TodoItem.cs` — `AddWorker`, `RemoveWorker`, `SetRequiredWorkers`, `CleanupWorkersOnAccessChange`
- `Services/TodoApi/Planora.Todo.Domain/Entities/TodoItemWorker.cs`
- `Services/TodoApi/Planora.Todo.Domain/Events/TodoWorkerJoinedDomainEvent.cs`
- `Services/TodoApi/Planora.Todo.Domain/Events/TodoWorkerLeftDomainEvent.cs`
- `Services/TodoApi/Planora.Todo.Domain/Events/TodoWorkerRemovedDomainEvent.cs`
- `Services/TodoApi/Planora.Todo.Application/Features/Todos/Commands/JoinTodo/`
- `Services/TodoApi/Planora.Todo.Application/Features/Todos/Commands/LeaveTodo/`
- `frontend/src/components/todos/worker-join-button.tsx`

### Key Rules

| Rule | Detail |
|---|---|
| Owner is never stored as a worker | Owner implicitly participates on their own task; calling `/join` as owner returns success with `isWorking: true` (idempotent, no DB write) |
| `RequiredWorkers` semantics | Total headcount including owner; `null` means unlimited; `1` means owner-only (always full) |
| Capacity check | `IsCapacityFull` when `RequiredWorkers.HasValue && Workers.Count >= RequiredWorkers - 1` |
| Join guards | Must have task access (public or shared); for non-public tasks, must be friends with owner; must not be at capacity; already-a-worker returns idempotent success |
| Leave guard | Owner cannot leave; leaving a task where user is not a worker throws `EntityNotFoundException` |
| Auto-removal on completion | When a viewer marks a shared/public task as Done via `UpdateTodoCommandHandler`, their worker row is automatically removed (guarded by `Workers.Any(w => w.UserId == userId)` to be a no-op when not a worker). Owner completion does not trigger removal because owners are never stored as workers. |
| Active worker task count | `ITodoRepository.GetActiveWorkerTaskCountAsync(userId)` returns the number of non-deleted, non-done tasks the user is currently working on. Called in `JoinTodoCommandHandler` and `LeaveTodoCommandHandler` after `SaveChangesAsync`; the result is stored in a local variable and logged at `Information` level — not returned to the client. |
| Eviction on access change | Removing a user from `SharedWith`, making a task private, or reducing `RequiredWorkers` below current worker count triggers automatic eviction (LIFO for capacity reduction) |
| EF Core persistence | Join/Leave handlers use `GetByIdWithIncludesTrackedAsync` (tracked query, no `AsNoTracking`). Change tracking correctly marks new workers as `Added` → `INSERT` and removed workers as orphaned `Deleted` → `DELETE` via `OnDelete(Cascade)`. No explicit `DbSet.Update()` call needed or made. |
| Worker fields in DTO | `workerCount`, `workerUserIds`, `requiredWorkers`, `isWorking` patched on every GET/mutation response |

### Frontend Behavior

- Worker count badge (`X/Y`) shows the current active workers (including owner's InProgress slot) over the total `requiredWorkers` capacity.
- `WorkerJoinButton` renders nothing for the owner; shows "Join" (indigo) for eligible friends; shows disabled "Full" with a lock icon when at capacity; shows "Leave" (outlined) when already working.
- `onJoin` / `onLeave` callbacks on `TodoCard` optimistically update `isWorking` and `workerCount` in local state.

## Task Comments (Collaboration Service)

### Purpose

Provide a persistent discussion timeline ("ветки") on public and shared tasks: user comments, the
pinned "Author's Note" (the task's description), and auto-generated system comments for lifecycle
events. The timeline is owned by the dedicated **Collaboration** service, decoupled from the Todo
aggregate. The Author's Note is **not** stored as a comment — the description is a single source of
truth on the task (Todo) and is synthesised into the timeline on read, so it shows instantly, always
matches the task card, and exists for tasks created before this service.

### Architecture

The Collaboration service owns the comment data (`planora_collaboration.collaboration.comments`) and
never reads the Todo database. Two integration boundaries keep it consistent (INV-OWN-1):

- **Authorisation + description (synchronous gRPC):** every read/write calls
  `TodoService.CheckTaskCommentAccess`, which returns `exists`, `hasAccess` (owner / shared / public +
  friendship), `ownerId`, `participantIds`, and the live task `description` + `taskCreatedAt` (used to
  synthesise the Author's Note). Collaboration applies no sharing rules of its own and stores no copy
  of the description.
- **System comments (asynchronous, Outbox→Inbox):** Todo publishes task-lifecycle events; the
  Collaboration consumers materialise the corresponding "created / started / left / completed" system
  comments. This replaces the former in-transaction comment writes inside the Todo handlers. Delivery
  is at-least-once, so consumption is **idempotent (INV-COMM-4)**: the event bus dedups on the
  integration event id via the `InboxMessages` table and skips a redelivered/replayed event before
  its handler runs — no duplicate system comments.
- **Near-instant dispatch (latency):** the `OutboxProcessor` is signal-driven, not just polled.
  `OutboxNotifyInterceptor` (an EF `SaveChangesInterceptor` on `TodoDbContext`) pulses an in-process
  `OutboxSignal` the moment a transaction that inserted an outbox row commits, waking the processor in
  milliseconds; the 5 s poll remains only as a safety net. Consumption is push-based (RabbitMQ), so a
  "started working / left / completed" system comment now lands in the branch within a fraction of a
  second of the action instead of waiting out a poll tick. A full batch (`BatchSize`) is drained in a
  tight loop before the processor idles again.
- **Author identity (synchronous gRPC):** comment author name + avatar are resolved live via
  `AuthService.GetUserProfilesBatch` (60 s cache), never stored — a profile rename reflects everywhere.

### Implementation

- `Services/CollaborationApi/Planora.Collaboration.Domain/Entities/Comment.cs`
- `Services/CollaborationApi/Planora.Collaboration.Domain/Repositories/ICommentRepository.cs`
- `Services/CollaborationApi/Planora.Collaboration.Application/Features/Comments/Commands/{AddComment,UpdateComment,DeleteComment}/` (handler + FluentValidation validator)
- `Services/CollaborationApi/Planora.Collaboration.Application/Features/Comments/Queries/GetComments/`
- `Services/CollaborationApi/Planora.Collaboration.Application/Features/IntegrationEvents/` (Inbox consumers)
- `Services/CollaborationApi/Planora.Collaboration.Infrastructure/Grpc/{TaskAccessGrpcClient,UserGrpcService,CachingUserService}.cs`
- `Services/TodoApi/Planora.Todo.Api/Grpc/TodoGrpcService.cs` — `CheckTaskCommentAccess`
- `frontend/src/components/todos/task-comments.tsx` (calls `/collaboration/api/v1/comments/*`)

### Key Rules

| Rule | Detail |
|---|---|
| Read access | any user the Todo access check returns `hasAccess` for (owner, or friend with public/shared visibility) |
| Write access | same `hasAccess` rule; the access decision is owned by Todo, not duplicated here |
| Content limits | comment max 2000 chars; cannot be empty (FluentValidation + domain). The description (Author's Note, max 2000) is validated by Todo, not here |
| Author identity | resolved live via `GetUserProfilesBatch` (name + avatar); the stored `AuthorName` is only a fallback when Auth is unreachable |
| Edit rules | comment author edits their own comment (enforced in `Comment.UpdateContent`); the description is edited on the task (`PUT /todos/...`), owner only |
| Optimistic concurrency | the `Comment` aggregate uses PostgreSQL `xmin` as a concurrency token. Mutation handlers MUST load the comment **tracked** (`CommentRepository.GetByIdAsync` inherits the tracking base) — an `AsNoTracking` load drops the shadow `xmin`, making every edit/delete fail with a spurious 409 `CONCURRENCY_CONFLICT` |
| Delete rules | comment author OR task owner; soft delete; plain system comments cannot be deleted |
| `IsEdited` | true when `UpdatedAt > CreatedAt + 5 seconds` for a user comment; system comments and the synthesised Author's Note never report edited |
| Cascade delete | task delete emits `TaskDeletedIntegrationEvent`; the consumer soft-deletes the timeline |
| User delete | `UserDeletedIntegrationEvent` soft-deletes all comments authored by that user |
| Notifications | adding a comment enqueues a `NotificationEvent` per other participant (Outbox → Realtime/SignalR) |
| Pagination | `GET /comments/{taskId}` accepts `pageNumber` (default 1) and `pageSize` (default 50); oldest-first |

### System Comments

System comments are materialised by the Collaboration consumers from Todo task-lifecycle
integration events. They are never authored by a user — `AuthorId = Guid.Empty`, `AuthorName = ""`,
`isOwn = false`, `isSystemComment = true`. The Author's Note is **not** a stored comment: it is
synthesised on read (`isGenesisComment = true`, `id` = task id, author = task owner) from the live
task description, so it is never materialised by these consumers.

| Todo trigger | Integration event | System comment text | Collaboration consumer |
|---|---|---|---|
| Task created | `TaskCreatedIntegrationEvent` | `"{name} created the task"` | `TaskCreatedEventConsumer` |
| Owner → InProgress | `TaskActivityIntegrationEvent (StartedWorking)` | `"{name} started working on the task"` | `TaskActivityEventConsumer` |
| Owner → Todo (from InProgress) | `TaskActivityIntegrationEvent (Left)` | `"{name} left the task"` | `TaskActivityEventConsumer` |
| Worker joined | `TaskWorkerJoined`→`TaskActivity (StartedWorking)` | `"{name} started working on the task"` | `TaskActivityEventConsumer` |
| Worker left | `TaskActivityIntegrationEvent (Left)` | `"{name} left the task"` | `TaskActivityEventConsumer` |
| Task completed | `TaskActivityIntegrationEvent (Completed)` | `"{name} completed the task"` | `TaskActivityEventConsumer` |

`{name}` is captured in the event by Todo (from `ICurrentUserContext.Name` → `Email` → `UserId`),
so Collaboration needs no extra lookup to render the sentence. Consumers are idempotent under replay
(INV-COMM-4).

### Frontend Behavior

- `BranchFeed` renders inside the fixed-size branch/edit modal (`edit-todo-modal/branch-feed.tsx`).
- Comments are fetched oldest-first (chat style) on mount; "Load earlier" button appends the next page.
- `isOwn` controls edit/delete button visibility; `isEdited` renders "(edited)" label.
- Ctrl+Enter submits the draft; Escape cancels description mode.
- Soft-deleted comments are removed from local state immediately without a full refetch.
- System comments (`isSystemComment: true`) render on the activity rail with a calm, monochrome badge — a circular grey marker centred on the rail line carrying a simple icon that hints at the event (created = Plus, started working = Play, left = LogOut, completed = Check, other = Circle) — followed by the sentence; no edit/delete. The rail itself is a single continuous gradient line that spans the whole timeline (it lives in a content-height wrapper, so it never breaks when the feed grows and scrolls); user-message avatars are centred on the same line.
- Long unbroken text wraps: message, Author's Note, and system-event text use `overflow-wrap: anywhere` / `word-break: break-word`, so a very long word or URL with no spaces wraps onto the next line instead of forcing a horizontal scrollbar.
- Leaving work never closes the modal: stopping the in-progress status — via the header pill, the compose "+" menu, on either the active feed or the dashboard — keeps the branch modal open so the "left the task" event is read in place.
- **Opens at the newest message:** on first load (and after a take/leave/complete action) the rail pins to the bottom so the latest activity is in view; "load earlier" and description edits preserve position instead of jumping.
- **Live updates without re-opening:** there is no realtime socket, so the feed merges the newest page on a 5 s interval (paused while editing) and reconciles by comment id — new messages, edits, and the system status-comments appear on their own. After a take/leave/complete action it additionally schedules short catch-up merges (≈0.6 / 1.5 / 3 s); combined with the signal-driven outbox dispatch (see Architecture above), the status system-comment now shows in well under a second. The merge only re-pins to the bottom when the reader was already there.
- **Non-owner date popover:** a viewer who is not the task owner sees the priority/date/visibility tokens read-only. The date popover omits the Today/Tomorrow/+3 days/Next week quick-pick row entirely (not merely disabled) — only the read-only calendar remains.
- **Sticky Author's Note:** the pinned card lives at the top of the scrollable rail and scrolls away with content. Once it passes out of view the feed shows a condensed frosted-glass bar (author avatar + truncated first line + animated chevron) at the top of the feed area. Clicking the condensed bar smoothly scrolls back to the full card and fires a violet attention pulse (`genesis_highlight` keyframe) so the note is easy to spot. The bar animates in/out with a spring (Framer Motion `AnimatePresence`).
- **Compose "+" menu actions:** the menu is visible to all participants (owner and collaborators). The "Description" attachment item is shown only to the task owner and is muted once a description exists (already added); the owner also gets a "Subtask" item (authored in the same compose field). **Once the task is completed the menu offers nothing** — description, subtask, and the take/complete actions are all hidden, so the "+" simply doesn't open on a done task. Two action items are otherwise shown to everyone:
  - **Take into work / Leave task** — mirrors the existing join/leave flow exactly (owner: `status → inProgress` / `status → todo`; viewer: `joinTodo` / `leaveTodo`). The button label and icon flip between "Take into work" (Zap, indigo) and "Leave task" (LogOut, red) depending on the current in-progress state. An optimistic `workOverride` state in the modal flips the pill in the header bar instantly before the parent refetch arrives. Leaving — via this menu **or** the header pill — keeps the modal open so the "left the task" event is read in place.
  - **Complete task / Reopen task** — mirrors the existing complete flow (owner: `status → done`; viewer: `completedByViewer → true`). Closes the modal on success. **Reopening is author-only**: a viewer can mark a shared task done for themselves but cannot return it to work — the completed-state menu shows them only **Duplicate** (see "Completed-task actions" above), and any reopen attempt surfaces the "Only the author can reopen this task" toast.

## Shared Todos And Hidden Viewer Preferences

### Purpose

Allow a viewer to hide a shared/public task without changing the owner's task. Hidden shared/public tasks must not leak owner content.

### Implementation

- `Services/TodoApi/Planora.Todo.Application/Features/Todos/TodoViewerStateResolver.cs`
- `Services/TodoApi/Planora.Todo.Application/Features/Todos/HiddenTodoDtoFactory.cs`
- `Services/TodoApi/Planora.Todo.Application/Features/Todos/Commands/SetTodoHidden`
- `Services/TodoApi/Planora.Todo.Application/Features/Todos/Commands/SetViewerPreference`
- `Services/TodoApi/Planora.Todo.Domain/Entities/UserTodoViewPreference.cs`
- `frontend/src/app/todos/page.tsx`
- `frontend/e2e/auth-todos-sharing-hidden.api.spec.ts`
- `docs/DECISIONS/0004-viewer-specific-todo-visibility.md`

### Key Rules

| Viewer | Hidden behavior |
|---|---|
| Owner/private task | uses `TodoItem.Hidden`; private owner task remains readable even when hidden |
| Owner/shared task | uses viewer preference or legacy global hidden state |
| Non-owner public or directly shared friend task | uses viewer preference only |

### Per-Viewer Completion

Completion state is tracked independently per participant. Marking a public or shared task as "done" as a viewer (non-owner) writes only to `UserTodoViewPreference.CompletedByViewer` — it never changes `TodoItem.IsCompleted` or any owner-facing state. The owner completing the task writes to `TodoItem` only and does not affect any viewer's `CompletedByViewer` flag.

**Reopening is author-only.** A viewer may complete a task for themselves (`CompletedByViewer → true`) but cannot return it to work: `SetViewerPreferenceCommandHandler` throws `ForbiddenException` on a `CompletedByViewer: false` request when the viewer's stored preference is already completed. The non-owner's path forward on a done task is **Duplicate** (open to any participant), not reopen. The owner reopens freely (writes `TodoItem.Status`).

| Participant | Completion stored in | Affects other participants? |
|---|---|---|
| Owner | `TodoItem.IsCompleted` / `TodoItem.Status` | No |
| Non-owner viewer | `UserTodoViewPreference.CompletedByViewer` | No |

`UserTodoViewPreference` is upserted via `UserTodoViewPreferenceRepository.UpsertAsync`, which checks the EF Core change-tracker for an already-tracked instance before falling back to an `AsNoTracking` read, avoiding the double-query identity-map bug where the same object reference would cause all property assignments to be no-ops.

Redacted shared/public DTOs contain:

- same todo id;
- `UserId = Guid.Empty` for non-owners;
- `Title = "Hidden task"`;
- `Hidden = true`;
- empty/default status, completed flag, tags, shared user ids, created date, and date/completion metadata;
- preserved non-content visual state: `Priority`, `IsPublic`, `HasSharedAudience`, and `IsVisuallyUrgent`, so collapsed cards keep urgent/shared frames after a page refresh without exposing the hidden task body;
- viewer category id/name/color/icon if available.

The frontend performs optimistic collapse/redaction when hiding a shared task, but server-side redaction is the source of truth. Reveal is not optimistically expanded: `frontend/src/app/todos/page.tsx`, `frontend/src/app/dashboard/page.tsx`, and `frontend/src/app/todos/completed/page.tsx` keep the hidden card collapsed until `fetchTaskById` returns full task details.

Automated verification: `frontend/e2e/auth-todos-sharing-hidden.api.spec.ts` covers registration, email verification, accepted friendship, shared todo creation, hidden redaction, owner visibility, and reveal behavior through the API Gateway and Docker services.

## Messaging

### Purpose

Send and fetch direct messages.

### Implementation

- `Services/MessagingApi/Planora.Messaging.Api/Controllers/MessagesController.cs`
- `Services/MessagingApi/Planora.Messaging.Application/Features/Messages`
- `Services/MessagingApi/Planora.Messaging.Domain/Entities/Message.cs`

### Key Rules

| Field | Rule |
|---|---|
| `recipientId` | required |
| `subject` | required, max 200 |
| `body` | required, max 10000 |
| `pageSize` | max 100 |

The HTTP controller overwrites sender from the current user context by sending `SenderId = null` into the command.

## Realtime Notifications

### Purpose

Track current connections and deliver notifications through SignalR and service notification abstractions.

### Implementation

- `Services/RealtimeApi/Planora.Realtime.Api/Controllers/ConnectionsController.cs`
- `Services/RealtimeApi/Planora.Realtime.Api/Controllers/NotificationsController.cs`
- `Services/RealtimeApi/Planora.Realtime.Api/Program.cs`
- `Services/RealtimeApi/Planora.Realtime.Infrastructure/Hubs/NotificationHub.cs`

### Key Rules

- `/api/v1/connections/active` returns only the current user's connections.
- `/api/v1/connections/stats` is admin-only.
- `/api/v1/notifications/send` sends to the authenticated user from the JWT `sub` claim.
- `/api/v1/notifications/broadcast` is admin-only.
- SignalR reads `access_token` from the query string for `/hubs` paths.
- Redis backplane channel prefix is `planora`.

## Live Sync And Branch Presence

### Purpose

Reflect other users' actions in the UI the instant they happen — no manual refresh — and show who is
typing in a branch. One SignalR connection per client carries notifications, data-sync signals and
typing presence.

### Implementation

- `BuildingBlocks/Planora.BuildingBlocks.Application/Messaging/Events/RealtimeSyncIntegrationEvent.cs` — the single fan-out contract.
- TodoApi command handlers (`CreateTodo`/`UpdateTodo`/`DeleteTodo`/`JoinTodo`/`LeaveTodo`/`CreateSubtask`/`DuplicateTodo`) emit it; feed audience resolved by `Services/TodoApi/Planora.Todo.Application/Common/RealtimeAudience.cs`.
- CollaborationApi `AddComment`/`UpdateComment`/`DeleteComment` emit the branch-scope event.
- `Services/RealtimeApi/.../RealtimeSyncEventHandler.cs` + `RealtimeBroadcaster.cs` fan it out; `NotificationHub.cs` hosts the authorized branch rooms + typing relay.
- Frontend: `frontend/src/lib/realtime/client.ts` (single connection), `hooks.ts` (`useFeedSync` / `useBranchRoom` / `useTyping`), `components/realtime-manager.tsx` (lifecycle), wired into `app/tasks/page.tsx`, `app/dashboard/page.tsx`, and `components/todos/edit-todo-modal/branch-feed.tsx`.

### Key Rules

- **Feed audience** = task owner + explicitly shared-with users + (when the task is public) the
  owner's accepted friends. An un-share/un-publish also reaches the users who just lost access, so
  they drop the card. Resolution happens in the producing service; RealtimeApi only routes.
- **Branch rooms** (`task:{id}`) require authorization via TodoApi's `CheckTaskCommentAccess` gRPC;
  joins fail closed. Membership is reference-counted client-side and re-joined on reconnect.
- **Typing** is ephemeral (never persisted), relayed only to rooms the caller joined, throttled on
  send, idle-cleared, and TTL-swept; the indicator reads "Имя Фамилия печатает…" (multi-user aware).
- **Signals carry no content** — only ids + an action string. The client refetches through the
  normal authorized endpoints, so a stale or forged signal can never leak data a user may not read.
- A client **ignores its own echoes** so optimistic updates are never clobbered.
- The branch's 9-second poll remains as a backstop if the socket is temporarily down.
- **Live sync never fails a write.** Feed-audience friend resolution is best-effort: an Auth-gRPC
  outage degrades the audience to owner + shared-with rather than throwing, so the underlying task
  mutation always succeeds (`RealtimeAudience.SafeGetFriendIdsAsync`).
- **Friend-id lookups are cached 30s** (`CachingFriendshipService`) to keep the feed-audience hot
  path cheap, but the `AreFriendsAsync` authorization check is never cached — every access decision
  sees live friendship state, so a stale id list can only cost a content-free fan-out signal.
- The frontend holds **one** SignalR connection and never opens a second during an automatic
  reconnect (e.g. a token refresh mid-reconnect).

## Product Analytics Events

### Purpose

Accept a small allowlist of frontend product events and log them through structured business logging.

### Implementation

- `Services/AuthApi/Planora.Auth.Api/Controllers/AnalyticsController.cs`
- `BuildingBlocks/Planora.BuildingBlocks.Application/Services/IBusinessEventLogger.cs`
- `frontend/src/lib/analytics.ts`

### Key Rules

- Endpoint: `POST /auth/api/v1/analytics/events`
- Requires bearer auth and CSRF.
- `eventName` must be allowlisted.
- `properties` must be a JSON object and max 4096 bytes.
- Returns `202 Accepted` on success.
- Frontend dispatch requires an access token; unauthenticated restore/login screens do not post analytics.
- Frontend analytics failures are swallowed.

Allowlisted product event names:

- `SIGNUP_COMPLETED`
- `FIRST_TASK_CREATED`
- `FIRST_CATEGORY_CREATED`
- `FRIEND_REQUEST_SENT`
- `FRIEND_REQUEST_ACCEPTED`
- `TODO_SHARED`
- `HIDDEN_TODO_REVEALED`
- `SESSION_RESTORED`
- `TOKEN_REFRESH_FAILED`

## Animated Background

The app ships a fragment-shader background (`ColorBends`) rendered via
Three.js, wrapped in a lazy + Suspense layer (`ColorBendsLayer`) that is
dropped once into the root layout and sits behind all content.

### Defaults

| Setting | Value |
|---|---|
| Colors | `["#d4d4d4", "#9e9e9e", "#616161"]` (light → mid → dark grey) |
| Rotation | `-65°` |
| Speed | `0.36` |
| Scale | `1.4` |
| Frequency | `1` |
| WarpStrength | `1` |
| MouseInfluence | `0.8` |
| Noise | `0` (disabled) |
| Parallax | `0.65` |
| Iterations | adaptive (1 / 2 / 3 by `navigator.hardwareConcurrency`) |
| Intensity | `1.2` |
| BandWidth | `6` |
| Transparent | `true` |

### Implementation

- `frontend/src/components/backgrounds/color-bends.tsx` — Three.js component; exports `ColorBends` and `hexToVec3`.
- `frontend/src/components/backgrounds/color-bends-layer.tsx` — lazy + Suspense wrapper; chooses fragment-shader iterations per device, applies `fixed inset-0 -z-10 pointer-events-none`.
- Iteration heuristic (`useState(detectIterations)` so first paint is final): ≤ 2 cores → 1, 4–7 cores → 2, ≥ 8 cores → 3.
- Honours `prefers-reduced-motion: reduce` directly (single static frame, no RAF loop). Framer-motion components honour the same preference via the global `MotionConfig reducedMotion="user"` in `frontend/src/app/layout.tsx`.
- Pauses on `visibilitychange` (tab hidden) and resumes on tab visible.
- Pointer tracking via `window` (not container) so mouse influence still applies through `pointer-events-none`.
- Full cleanup on unmount: `cancelAnimationFrame`, `ResizeObserver.disconnect`, `renderer.dispose()`, `renderer.forceContextLoss()`, canvas `removeChild`.
