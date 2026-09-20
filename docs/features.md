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
| 2FA confirm | requires a 6-digit TOTP code; on success returns 10 single-use recovery codes formatted `XXXXX-XXXXX`. Codes are hashed with PBKDF2 (HMAC-SHA512, 210,000 iterations) before storage and each is consumed once on use. A new set is generated on every re-confirmation. |
| 2FA login | TOTP code is tried first; if it fails, a recovery code is accepted as a fallback. |
| TOTP secret | encrypted at rest with ASP.NET Core Data Protection. |
| Password change / reset | invalidates all existing access tokens via per-user security stamp in Redis. |
| Admin users | admin-only user list/statistics/detail endpoints exist. |

### Frontend Behavior

- The profile route presents account work as a single continuously scrolling profile center rendered in a monochrome "spec-grid" style with full light/dark theming: an identity header (avatar with click-or-drag upload, status pills, and a metric grid) followed by stacked sections for identity, security, sessions, login history, friends, and admin tools.
- Navigation is a sticky side rail (horizontal scroller on mobile) driven by a scroll-spy: the rail highlights whichever section is in view via `aria-current`, and clicking a rail item smooth-scrolls to that section. All sections render at once; each section's data is fetched lazily the first time it scrolls into view, and per-section `Refresh` buttons re-fetch on demand.
- Motion is deliberately restrained and never moves layout on scroll (which read as jank): the route-level `template.tsx` handles the page-enter fade (opacity only), the active rail item is tracked by a spring-animated sliding pill via a shared `layoutId`, and friend cards lift subtly on hover. The page root uses no entrance transform and `overflow-x: clip` (not `hidden`) so the sticky section rail anchors to the viewport correctly — a transform or `overflow: hidden` on the root would create a containing block / scroll context and break `position: sticky`. The rail sticks at `top-24` to clear the fixed navbar. Every animation collapses under `useReducedMotion()` (including switching smooth scroll to instant and the rail pill to zero duration). All existing Auth API calls are preserved unchanged for profile update, password/email changes, email verification, 2FA setup, session revocation, friend requests, and admin user lookup.
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
- `frontend/src/app/tasks/page.tsx`
- `frontend/src/app/tasks/completed/page.tsx`
- `frontend/src/hooks/use-list-navigation.ts` — the list cursor and multi-selection
- `frontend/src/components/todos/quick-capture.tsx`
- `frontend/src/components/ui/selection-bar.tsx`
- `frontend/src/components/ui/update-pill.tsx`
- `frontend/src/components/ui/undo-bar.tsx`
- `frontend/src/lib/shared-origin.ts` — the card → editor transition geometry

### Key Rules

| Area | Behavior |
|---|---|
| Title | required on create, max 200 |
| Description | optional, max 2000 — enforced consistently by the create/update validators and the EF `Description` column (`HasMaxLength(2000)`) |
| Status | backend statuses are `Todo`, `InProgress`, `Done`; parser accepts legacy aliases such as `pending` and `completed` |
| Priority | `VeryLow`, `Low`, `Medium`, `High`, `Urgent`; EF stores integer value |
| Expected/due dates | expected date cannot be after due date when both are present |
| Due-date interval | the estimated-completion date can be a single day **or** an interval: `dueDate` is the single date / later bound (deadline), `dueDateStart` the optional earlier bound. When set, `dueDateStart ≤ dueDate` (enforced by the domain `SetDueRange` and the create/update validators); a lone `dueDateStart` without `dueDate` is rejected. Clearing on update requires `clearDueDate: true` (a bare null `dueDate` reads as "unchanged" on the full-payload autosave) |
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
| Creation | **any branch participant** can add one — the owner, or a friend with access to a shared/public parent (`CreateSubtaskCommandHandler` mirrors the `GET …/subtasks` access check, so collaborators contribute steps, not just the author). The child is **owned by the parent owner** for access purposes (completion/visibility logic unchanged), but the actual creator is recorded in **`CreatedByUserId`** so they can manage the step they added; it inherits the parent's category/visibility/sharing |
| Category | always inherited from the parent (never set independently) |
| Visibility | public exactly when the parent is public; inherits the parent's shared audience. A parent's category/visibility/sharing change **propagates** to its subtasks |
| Dates | none — a subtask never has a due or expected date |
| Priority | **none in the UX** — a subtask is just a checkable titled step; no priority is shown, chosen, or edited. (The entity still has a priority column, defaulted server-side; it is never surfaced.) |
| Title length | a subtask's whole content lives in its title, so it allows **up to 1500 characters** (regular-task titles stay ≤200). Enforced by `CreateSubtaskCommandValidator` (1500), `UpdateTodoCommandValidator` (1500, shared with subtask renames), the widened `TodoItems.Title` `varchar(1500)` column, and the frontend `SUBTASK_MAX = 1500` (create textarea + inline edit textarea both wrap/grow) |
| Editing | the title is editable (and the subtask deletable) by the **parent owner OR the subtask's creator** (`CreatedByUserId`) — inline edit in the card; double-click the title or the pencil. Other participants may only complete/take-into-work, not rename or delete |
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

#### Finishing a task with unfinished subtasks

Completing a task that still has **open subtasks** raises a confirmation **before** the task is
finished — for **every** participant who can complete it (owner or collaborator), not just the
author. The dialog offers two choices — **«Выполнить»** (finish anyway) and **«Продолжить работу»**
(keep working, dismiss) — plus a **«Больше не показывать это окно»** checkbox that, when ticked,
persists the opt-out so the warning is skipped from then on.

| Aspect | Rule |
|---|---|
| Trigger | shown only when **finishing** a task (never on reopen) that has at least one open subtask, and only if the viewer has not opted out |
| Open count | `TodoItemDto.openSubtaskCount` — subtasks not `Done` and not deleted; computed server-side via a single grouped query and surfaced by `GET /todos` (lists) and `GET /todos/{id}` (branch). The branch modal also re-derives the count from its **live, loaded** subtask list |
| Entry points | both completion gestures are covered — the card's **quick-complete** check button (the warning fires **before** the completion animation, so "keep working" never leaves the card mid-animation) and the branch modal's **"Complete task"** action |
| Opt-out | the checkbox writes a local, client-only preference (`localStorage` key `planora:pref:suppressIncompleteSubtaskWarning`); it never leaves the device and degrades to "show the warning" if storage is unavailable |

Frontend: `ConfirmDialog` (extended with an optional `dontAskAgainLabel` checkbox whose state is
passed to `onConfirm`), the shared copy/helpers in `lib/subtask-warning.ts`, the preference store in
`lib/ui-preferences.ts`, and the guards in `todo-card.tsx` (`shouldWarnBeforeComplete`) and
`edit-todo-modal/branch-feed.tsx` (`requestComplete`). Backend: `OpenSubtaskCount` on `TodoItemDto`,
`ITodoRepository.GetOpenSubtaskCountsAsync` (grouped count over `ix_todo_items_parent_deleted_created`).

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

- **Restore task** — reopens it, moving it back to active. **Anyone may restore *their own*
  completion** (an owner reopening the task globally, or a viewer clearing their per-viewer
  completion) **as long as the author has not completed the whole task globally**. Once the author
  marks it `Done`, the task is closed for everyone: a viewer's reopen is rejected with
  `AUTHOR_ALREADY_COMPLETED` (both `SetViewerPreferenceCommandHandler` and the `PUT /todos/{id}`
  status path enforce it) and the UI shows a warning toast ("Нельзя восстановить — автор уже
  отметил задачу выполненной") and steers the viewer to Duplicate. Each DTO carries `ownerCompleted`
  (the author's real `Status == Done`) so the client can show the right affordance without a
  round-trip. When the **author** reopens a public/shared task, every viewer's per-viewer completion
  is bulk-cleared (`ClearCompletedByViewerForTodoAsync`) so it becomes active for everyone again;
  reopening returns the task to `Todo` (not `InProgress`), so "in work" is not implied.
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
| Restore availability | surfaced when the viewer has a completion to undo (`isCompleted` for the owner, `isCompletedByViewer` for a viewer) **and** `ownerCompleted` is not true; once the author closes the task globally the menu hides it and the server rejects reopen with `AUTHOR_ALREADY_COMPLETED` |
| Duplicate availability | surfaced when `isCompleted` to **any participant**; `onDuplicate` is wired un-gated by every page |
| Copied by Duplicate | title, description, priority, category (re-validated against the duplicator; dropped if not theirs/deleted), `isPublic`, shared audience (re-validated vs. the duplicator's current friends), tags, `requiredWorkers` |
| NOT copied | `dueDate`/`expectedDate`, completion state (copy starts active), the branch (comments & subtasks) |
| Security | duplicate access mirrors the view rule (owner, or friend who can see a public/shared task), re-validated server-side; a subtask cannot be duplicated (no standalone existence); reopen is allowed for one's own completion but blocked once the author has completed globally (`AUTHOR_ALREADY_COMPLETED`) |
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
place the calendar stays open; the modal's date token and the create panel's Due-date selector plate
both open the calendar as an anchored popover (`DatePopover`) — so the calendar is never shown
unprompted except on the dedicated branch page.

**The date calendar is a two-click range picker** (`DateCalendar`, logic in the pure, unit-tested
`computeNextDueRange`). The first click sets a single target date (the deadline). Clicking that same
day again clears it. Clicking a **different** day turns the selection into a sorted interval — the
later day is always the deadline (`dueDate`), the earlier becomes the start (`dueDateStart`) — so
picking an earlier day extends the interval backwards and a later day extends it forwards. Once a
full interval exists, the next click starts over with a fresh single date. While a single date is
set, hovering another day previews the interval it would create (a soft dashed band) before commit;
the committed interval renders as solid black bound caps joined by a filled band, animated with
framer-motion. The range highlight is intentionally **neutral gray** — the preview band, the hovered
ghost cap, and the in-range day labels are all gray, so the calendar stays monochrome instead of
using a colored (previously indigo) accent. Quick-picks (Today/Tomorrow/…) always set a single date. The popover/inline calendar
closes on terminal selections (a quick-pick, a completed interval, or a clear) but stays open after
the first single pick so the interval can be built in one go. Task cards render an interval as
`start → deadline`; overdue is judged on the deadline either way.

The editor seeds its local fields from the task **once per task** (`todo.id`), not on every prop
update — so on the page (where the parent feeds the saved task back after autosave) the controls
never "snap back". This matters because a friends-visibility task with no one selected persists as
`isPublic:false, sharedWith:[]`, indistinguishable from private; re-seeding on every update used to
flip the selection. The shared `Popover` animates open **and** close (framer-motion).

**Popover positioning modes** (`edit-todo-modal/popover.tsx`): the shared `Popover` renders in one of
two modes. By default it is an **in-flow absolute** child of its trigger wrapper — used inside the
scrollable edit modal, where the popover must scroll *with* the modal body. With the `portal` prop it
instead renders into a `document.body` portal with viewport-**fixed** positioning: it is glued to the
trigger via `getBoundingClientRect` (repositioning on capture-phase scroll + resize), **flips above**
the trigger when there isn't room below, and caps its `maxHeight` to the available space (scrolling
internally). Because a fixed/portaled element never contributes to the document's scroll height,
opening a `portal` popover can **never stretch the page** and closing it can **never snap** it — this
is what the create-task panel (on `/tasks` and the dashboard sidebar) uses for all four selectors, so
even the tall inline "create category" form stays inside the viewport instead of growing the page.
`PriorityPopover`, `DatePopover`, and `CategoryPopover` accept and forward an optional `portal` prop
(default `false`, so the edit-modal usages are unchanged).

The page owns the task + category data and wires every editor action against the API: owner
autosave (`PUT` preserving status), viewer category preference, take/leave work, complete/restore,
and duplicate (which navigates to the new copy's page). A missing/forbidden task shows a friendly
"not found" with a link back to `/tasks` (access is enforced server-side by `GetTodoById`).

Two ways to reach it: **Ctrl/⌘-click a task card** opens the page in a **new tab** (a plain click
still opens the modal), and the modal's top chrome has a grey **"Open page"** button (same row as
the In Progress pill) that opens it in a new tab. Both compute the URL from the task id;
`TodoCard` handles the modifier-click, `TodoEditor` (modal variant) renders the button.

### The keyboard over the task list

`/tasks` answers to a cursor that walks the list without the pointer
(`frontend/src/hooks/use-list-navigation.ts`, wired in `frontend/src/app/tasks/page.tsx`).
One `keydown` listener on `window` serves the whole list: one listener per row would be one
per mounted card, and it would require each row to hold DOM focus before its keys did
anything, which is not how a list reads to a keyboard user. The hook never moves focus — the
row under the cursor is simply the one tabbable row (roving `tabindex`), so `Tab` enters the
list once and the keys take over from there.

| Key | Acts on | Behaviour |
|---|---|---|
| `J` / `↓` | the cursor | Move down one row. Clamped at both ends, never wrapped — wrapping from the last row to the first teleports the reader somewhere they did not ask to be |
| `K` / `↑` | the cursor | Move up one row. With no cursor yet, `J` lands on the first row and `K` on the last |
| `Shift+J` / `Shift+K` / `Shift+↑` / `Shift+↓` | cursor + selection | Move and extend the selection. Moving back over a row that is already selected shrinks the selection instead of growing it in both directions |
| `G` `G` | the cursor | Jump to the first row. The two presses must fall inside 500 ms (`CHORD_WINDOW_MS`); any other key cancels a half-typed chord |
| `Shift+G` | the cursor | Jump to the last row |
| `Enter` | the row under the cursor | Open its branch editor |
| `Space` | the row under the cursor | Complete or reopen it — the same `handleComplete` path the card's check button takes |
| `E` | the row under the cursor | Opens the same editor as `Enter`; the page wires `onEdit` and `onActivate` to one handler |
| `1`–`5` | the row under the cursor | Set priority. The page drops the key unless the viewer owns the task (a shared viewer would earn a `403` for a key nobody offered them), and sends the whole task through `todoToOwnerPayload` because the endpoint is a `PUT` and a partial body clears what it omits |
| `X` | the row under the cursor | Add it to, or remove it from, the selection. The selection is always re-ordered to match the list |
| `Cmd/Ctrl+A` | every reachable row | Select all of them, and seat the cursor on the first row if it has none — row actions bail on a null cursor, so `⌘A` followed by `Space` or `Delete` used to do nothing. An empty list gives the browser its default back |
| `Delete` / `Backspace` | the row under the cursor **only** | Delete it, through the undo window described below |
| `Escape` | one layer per press | Clears the selection first; a second press drops the cursor. Deliberately not `preventDefault`-ed, so an outer layer keeps its own meaning for the key |

Two rules are not obvious from the key list:

- **The cursor is an id, not an index.** An index survives nothing this list does to
  itself — completing a task removes a row, a filter change replaces the whole array, a
  realtime reconcile reorders it — and an index-based cursor then points at a different task
  than the one being read. When the active id genuinely disappears the cursor falls back to
  the nearest surviving position rather than to nothing. The same reconcile drops ids from the
  selection once they leave the list, so a bulk action can never be sent for a task that is
  already gone.
- **`Delete` acts on the cursor, never on the selection.** A keystroke that silently took
  twelve tasks because an `x` earlier had scrolled out of view is not one anybody can take
  back. A gathered selection is deleted from the selection bar instead, which states the count
  before the word "Delete" — both on screen and in the button's accessible name.

Guards, all of them in the hook:

| Guard | Prevents |
|---|---|
| `event.defaultPrevented` bails | a widget closer to the event that already claimed the key from being second-guessed; it is also what makes the hook single-instance per page |
| Target is an `input`, `textarea`, `select`, or inside a `[contenteditable]` (tested with `closest()`, not only `isContentEditable`) | typing "extra jam" into the composer editing a task, toggling three others and deleting one |
| `Enter` / `Space` bail when the target is inside a `button`, `a[href]`, `summary`, or `[role="button"]` | one press both firing the row's own control and the list's binding |
| `Meta` / `Ctrl` / `Alt` bail, except for the select-all chord | claiming `Ctrl+D` (bookmark) as a delete |
| Arrow keys and `Space` are `preventDefault`-ed | the page scrolling on top of the hook's own `scrollIntoView`, and `Space` paging down on every completion |

The listener is attached in the **bubble** phase, so a popover or menu inside a row can keep a
key with `stopPropagation()`; a capture-phase listener on `window` could not be overruled.

**Scope.** The cursor addresses the *mounted* window of cards, not the whole filtered list —
the page mounts 24 cards and grows by 24 as the user scrolls (`INITIAL_VISIBLE_TASKS` /
`VISIBLE_TASKS_CHUNK`), and letting the cursor walk off into rows with no element would make
it appear to vanish. The hook detaches entirely (`enabled: false`) whenever the branch editor,
the create panel, or the category-filter modal is open — one flag, `listKeysEnabled`, also
hides quick capture and marks realtime arrivals as unsafe to apply, so the three cannot answer
the question differently. Detaching leaves the cursor where it was, so closing the dialog
returns the user to their place.

The `?` overlay (`frontend/src/components/ui/shortcuts-overlay.tsx`) is the on-screen copy of
this map, and `SHORTCUT_GROUPS` there is exported so the command palette prints the same
strings. See `docs/frontend.md` §7 for the cross-page keyboard model.

### Quick capture

`frontend/src/components/todos/quick-capture.tsx` is a 56×56 button fixed in the bottom-right
thumb zone (centred as a bar from `sm` up) that expands into **one field and nothing else**.
The full create panel asks for priority, due date, category and audience before it accepts a
task; every one of those is a decision, and a decision at the moment of capture is why a
thought stops being written down at all. Priority, dates, category, audience and description
are deliberately absent here and are added later from the card or the branch. The button and
the expanded pill share one `layoutId`, so the circle stretches into the bar rather than being
swapped for it.

| Aspect | Behaviour |
|---|---|
| Submit | `Enter` (or the ✓ button). The title is trimmed; an empty or whitespace-only field is a silent no-op, not an error |
| Double-submit guard | a `useRef` flag written synchronously inside the submit handler. `pending` drives the spinner, but a second `Enter` can land in the same tick, before React has re-rendered and disabled the button — both handlers would read `pending === false` and create two identical tasks |
| Rejection | the typed text **stays on screen**, focus returns to the field, and the message renders as a `role="alert"` with an `id` the input references through `aria-describedby`, so it is re-read on every return to the field. Clearing the field on failure would destroy the only copy of the thought |
| Title limit | 200 characters (`TITLE_MAX_LENGTH`), matching the create panel, so capture cannot produce a task the editor would reject |
| Collapsing | `Escape`, the ✕, or `hidden` flipping on **discards** the draft. Blurring does not, while there is text in the field — a tap landing just outside the pill on a 390px screen would otherwise throw away a half-typed sentence |
| Hidden | while a dialog, the create panel or the filter modal owns the screen, so it cannot float over a backdrop or be reached by `Tab` from behind one |

The page's handler (`handleQuickCapture`) deliberately does **not** reuse `handleCreate`:
`handleCreate` catches its own failure and raises a toast, and swallowing the error here would
let the component clear the field. The rejected promise is the contract. On success the created
task is inserted optimistically and the list reconciles silently in the background.

The component owns the bare `c` shortcut on `document`, gated on modifiers, an in-progress IME
composition, and any text-entry target. **It owns it on every screen that mounts quick
capture**, which is `/dashboard` and `/tasks`.

That is a deliberate correction. Both pages previously bound `C` to the full create panel with
their own capture-phase listener on `window`, so `c` never reached this component and the key
did the opposite of what the keyboard map promised: it opened the surface that asks for
priority, due date, category and audience before it will accept a task. One key now means one
thing. The full panel is still on both screens — its collapsed header **is** the "new task"
affordance — and it is opened by pressing that header, or from the command palette's "Create
task", which dispatches `OPEN_CREATE_EVENT`.

### Deleting a task, and deleting a selection

Deleting a task has **no confirmation dialog**. The card leaves the list immediately and the
`DELETE` request is only sent when a five-second window closes (`WINDOW_MS` in
`frontend/src/components/ui/undo-bar.tsx`); undo cancels the timer and nothing ever reaches the
server. That is what makes the affordance honest — the API has no restore endpoint, so an
optimistic delete with a "restore" button would be a lie. A confirmation still belongs on
anything the window cannot cover (deleting an account, revoking every session): those are
irreversible server-side, and five seconds is not consent.

Both `/dashboard` and `/tasks` work this way. The dashboard used to raise a `ConfirmDialog`
whose description read "This action cannot be undone", which was true of the request and false
of the intent — the point of the window is that the request has not been sent yet. Two screens
deleting the same object two different ways is not a nuance a user models; it is a product
contradicting itself. `/tasks/completed` still deletes through the dialog, because an archive
entry is not in a list anyone is scanning and the undo bar has nowhere to sit there.

| Aspect | Rule |
|---|---|
| Single delete | `requestDelete` removes the card optimistically (active tasks only — a completed card stays until the request lands) and remembers its index, so undo puts it back **in place** rather than on top. A server refusal re-inserts it at the same index and toasts |
| Selection delete | `requestDeleteMany` builds **one** undoable action carrying every id. Looping `requestDelete` would be wrong: `useUndoableAction` holds a single pending action and commits the previous one whenever a new one starts, so ten calls would commit nine deletions instantly and leave a window over only the last |
| Label | `“{title}” deleted` for one, `{n} tasks deleted` for a batch |
| Commit | `Promise.allSettled` over the ids, so one refusal does not abandon the rest |
| Partial failure | exactly the tasks that still exist are put back, at their recorded indices (ascending, so each index is still valid once the earlier ones are restored), and the toast names the split: `{failed} of {total} could not be deleted` |
| Bulk complete | runs the completions **sequentially**, not with `Promise.all` — the completion path refetches and rewrites the list, and ten of those racing produce ten different answers about what the list contains |
| Keyboard | no shortcut triggers a bulk action. Every selection-bar action is a press, and the destructive one is drawn in the product's one saturated colour and placed last |

### Realtime arrivals on the task list

A remote change that reconciles on arrival moves every card below the insertion point — under
a pointer that was already aimed at a row, and under the reading position the user had
scrolled to. So arrivals are **held and offered** rather than applied
(`useDeferredUpdates` + `UpdatePill` in `frontend/src/components/ui/update-pill.tsx`, the
`useFeedSync` callback in `frontend/src/app/tasks/page.tsx`).

| Signal | What happens |
|---|---|
| The signal's actor is the current user | ignored — the local optimistic update already applied it |
| `task.deleted` | applied **immediately**, never queued. Leaving a pressable card for a task that no longer exists earns the user a `404` for doing the obvious thing, and a removal only ever shortens the list, so nothing slides under the pointer the way an insert does. The completed count is re-fetched so the badge stays honest |
| Anything else | pushed into the queue, which applies it live only when **both** hold: the list is within 24px of the top (`DEFAULT_THRESHOLD`, measured on `window` here) **and** nothing is busy — `busy` on this page is `!listKeysEnabled`, i.e. the editor, the create panel or the filter modal is open. At the top an insert pushes content down without disturbing anything, and there is nothing above the fold to lose |

Pressing the pill flushes the whole queue and scrolls to the top; the ids are de-duplicated
first, because three edits to one task while the queue was held are still one task to re-read
and three refetches would race each other's writes. Reaching the top by scrolling does **not**
drain the queue on its own — a user scrolling up to re-read something has not asked for the
list to change under them, and a pill that vanished unpressed would leave them wondering what
they missed. `clear()` exists for the caller that has just refetched, so queued items are not
inserted a second time.

The pill is drawn out of flow (a zero-height sticky strip with the button overflowing it), so
its appearance and disappearance shift nothing; the list column must therefore not have an
`overflow-hidden` ancestor, which would clip it. Its screen-reader announcement is
count-free and fires once per batch: the region is a sibling of the button, holds text written
once on mount, and is unmounted with the batch, so a burst of ten realtime ticks cannot become
ten interruptions. The count lives on the button's `aria-label`, which is read on arrival
rather than shouted on change.

### Presence and redaction in the task editor

The branch editor's header carries two marks above the meta strip, rendered only when there is
something to say (someone is working, or the task is not private) —
`frontend/src/components/todos/edit-todo-modal/modal.tsx`.

**Presence** (`frontend/src/components/ui/presence-row.tsx`) draws the people in the task as
overlapping faces, with the `N of {requiredWorkers}` fraction beside them when a capacity is
set. A newly arrived face springs in and is ringed once by an accent stroke that draws itself
(`pathLength`) and then fades. First mount is deliberately not an arrival: a page load would
otherwise ring every participant at once and teach the user, on first exposure, that the ring
means nothing. Multiple arrivals in one payload are staggered by 60 ms so the eye can count
them. The ring is skipped entirely under `prefers-reduced-motion`. Accessibility is one
sentence — "{first name} and N others are working on this. N of M needed." — and every visual
part below it is `aria-hidden`, so a screen-reader user is not walked through a crowd one
person at a time.

**What actually drives it.** The server resolves live worker identities (`TodoItemDto.Workers`,
name + avatar from Auth at query time) **only for subtask reads** — `GetSubtasksQueryHandler`
is the one handler that populates the field, and the AutoMapper profile explicitly ignores it.
A top-level task carries `workerUserIds` and `workerCount` and nothing else. So the editor
resolves the names **client-side**, matching those ids against the friend list it has already
loaded for the audience picker (`useFriends`, one cached fetch shared across consumers). That
costs no extra request and avoids an identity lookup per task across a 200-task page, which is
the N+1 the list endpoints already avoid for author names. A worker id that is not in the
viewer's friend list resolves to no name and no avatar, and reads as "Someone" in the
sentence.

**Redaction** (`frontend/src/components/ui/redaction-badge.tsx`) states the audience as a ring
whose gap opens and closes, beside the word:

| Audience | Ring |
|---|---|
| `private` | one narrow cut (12% of the circumference) plus a filled centre dot — you, the only viewer. The dot is what separates it from `public` at the 14px size, where the gap is about two pixels |
| `shared` | cut open from 16%, widening 4.5% per viewer, saturating at 50% (eight viewers) — past half the circumference the mark stops reading as a ring and starts reading as a bracket. The viewer count rolls beside it |
| `public` | a closed ring |

The mark is geometry, not hue: the drawn arc is `ink` and the cut arc is `line`, so it survives
greyscale and every kind of colour blindness, and it does not compete with the one saturated
colour the product reserves for `alert`. Animating the dash pattern is the system's one
sanctioned exception to "transform and opacity only" — no transform turns an arc into a longer
arc. The whole mark, word and count collapse into a single node with one name
(`role="img"`), so the audience is not announced twice.

The editor never produces `public` from this control: it writes `isPublic: false` on every save
and expresses reach through the shared list, so the badge reports `private` or `shared` only.
The viewer count is the length of that shared list.

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
- **Completed archive — search by completion date** (`frontend/src/app/tasks/completed/page.tsx`,
  `components/todos/date-filter-popover.tsx`): the completion-date filter is embedded **inside the
  QuickFilter plate** via its `dateControl` slot (`DateFilterPopover`) rather than sitting as a
  separate block. A compact trigger (same height as the plate's other controls, so the plate never
  grows) opens the calendar as a **floating popover** — it is absolutely positioned and overlays the
  task grid below, so opening it never reflows the page or stretches the plate. The popover scales out
  of its top-right corner (origin-aware), closes on outside-click / `Escape`, and honors
  `prefers-reduced-motion`. It reuses the same two-click `DateCalendar` (headless, quick-picks hidden)
  as the estimated-completion date, so a first click picks a single day and a second click turns it
  into a range. **The popover stays open after the first pick** so the day can be extended into a
  range; it closes only when the range completes (the second pick) or the user dismisses it
  (outside-click / `Escape`). This is why the filter bar is rendered whenever `categories.length > 0`
  and **not** gated on `!loading`: a date pick triggers a refetch (`setLoading(true)`), and gating the
  bar on loading unmounted it mid-pick, which destroyed the popover's open state and snapped the
  calendar shut after the first click. The selected day(s) are sent to the API as an inclusive
  `completedFrom`/`completedTo` window (local day edges → UTC instants), and the server filters on
  `CompletedAt` — so the search spans the **whole archive**, not just the current page. Picking a
  window resets paging to page 1; an empty result shows a dedicated "nothing finished in this period"
  state with a one-click clear. The control is shown whenever there is something to search or a window
  is already applied. The day(s) →
  inclusive `completedFrom`/`completedTo` translation is the pure, unit-tested `buildCompletionWindow`
  (`utils/completion-window.ts`). It is keyboard-accessible: the trigger carries `aria-expanded` +
  `aria-haspopup="dialog"` + `aria-controls`, the popover is a labelled `role="dialog"`, and both the
  trigger and clear controls show `focus-visible` rings.
- **Completed-card title** (`TodoCard`): a resting completed task title renders at `text-base md:text-lg`
  (up from `text-sm`) so it stays readable in the otherwise-sparse completed card. The size is shared
  with the reopening state so it never jumps during the reopen transition, and stays just below the
  active-task title (`text-lg md:text-xl`) to keep completed tasks visually de-emphasised.
- **Completed-card title strike animation** (`TodoCard`): a resting completed task shows its title
  struck through; on card hover the strike **wipes away left→right** while the title brightens to
  fully readable, and leaving the card draws it back the same way. The line is painted as a gradient
  on the text with `box-decoration-break: clone` (so it follows wrapped lines) and animated by
  shrinking its `background-size` width — smoother than fading `text-decoration-color`. Honors
  `prefers-reduced-motion` (the transition is dropped).
- Sorting groups active tasks by date urgency and priority in `frontend/src/utils/sort-tasks.ts`.
- Category filter state is stored in local storage by `frontend/src/utils/category-filter.ts`, scoped per user under the key `todos-cat-filter:<userId>`. Each account's filter survives a hard refresh (including Ctrl+F5), and switching accounts never leaks one user's filter onto another. The `/tasks` and `/tasks/completed` pages re-read the filter whenever the active user changes; an unknown/logged-out user resolves to an empty filter.
- Keyboard shortcuts confirmed in `frontend/src/app/todos/page.tsx`: `F` opens category filter and `C` opens create panel when focus is not inside form controls.
- Dashboard also keeps the `C` create-panel shortcut. The collapsed panel header shows "New task" as its title and a `press C to open` `<kbd>` hint in the subtitle so the shortcut is self-documenting without a separate dismissible banner.
- Pressing `Escape` inside the create task panel returns it to the collapsed create action with a calm layout fade instead of leaving an empty white panel or adding bounce.
- `frontend/src/components/todos/todo-card.tsx` runs a short local completion/reopen animation before calling the page-level status update, so list refreshes happen after the card has visually acknowledged the action.
- Hidden/collapsed task cards blur the category pill until hover/focus, keeping category filtering visible without exposing it at rest.
- Urgent, overdue, and due-today private cards use a red border only; shared/public urgent cards keep the blue shared frame and use a red left border wall. The previous filled left urgency stripe is intentionally absent.
- **Create task panel (redesigned)** (`frontend/src/components/todos/create-todo-panel.tsx`): the title
  and details are naked oversized inputs behind a single left rule ("What needs to be done?" /
  "Add details — optional."), followed by a row of four compact **selector plates** — Priority,
  Due date, Category, Share — each opening an anchored popover (the shared `PriorityPopover`,
  `DatePopover` with its Today/Tomorrow/+3/Next-week quick-picks, `CategoryPopover`, and a
  panel-local `SharePopover`). The plate row auto-fits: 4-up on the wide `/tasks` page, stacking in
  the dashboard sidebar. Due date and Category plates expose inline ✕ clear controls; the footer
  shows a `⌘/Ctrl` + `↵` "to create" hint and a black `→ Create task` action that stays disabled
  until a title exists. Character-limited fields keep `current/max` counters (red from 80% of the
  limit). Share semantics are unchanged: all-friends visibility (public) and direct friend selection
  are mutually exclusive, and the panel exposes no tags field. `CategoryPopover` now accepts an
  optional `onDeleteCategory`, so categories can still be deleted from the create panel's list (the
  edit modal does not pass it and is unchanged); category creation happens immediately inside the
  popover (default swatch + Briefcase icon) instead of being deferred to task submit. `Escape`
  closes an open selector popover first and collapses the panel only on the next press. All four
  selector popovers render in a body portal (see "Popover positioning modes"), so the panel stays
  `overflow-hidden` through the whole collapse animation without trapping them and **without ever
  growing the page** — even the tall inline "create category" form flips/caps inside the viewport
  instead of stretching the document and snapping back on close.
- **/tasks control deck (redesigned)**: the page header is a `Workspace` eyebrow over an oversized
  `Tasks` title with `N active` / `N done` count pills on the right (numbers roll vertically on
  change). The create panel and the Quick Filter plate ("Filter tasks by category." / `F` hint /
  "Open menu") are **both always on screen**, with the **create panel above the filter** (task
  creation is the page's primary action) — the panel's collapsed header is the "new task" affordance
  and expands in place, so there is no separate New Task button and the `F` shortcut works regardless
  of the panel state.
- On the dashboard, the create panel opens with a softened layout transition and staged field reveal. Its primary plus icon becomes a rotated close action while the panel is open, so the same control pattern can open and close the draft surface.
- Toast notifications render on the toast z-index layer and start below the fixed navbar, so completion/update feedback is not hidden behind the header.
- The floating navbar quick-creates tasks (title only, private, no category) and dispatches a `planora:task-created` custom DOM event on success, carrying the freshly created task on `event.detail.todo` (see `frontend/src/lib/events.ts`). Both the dashboard and todos pages listen for this event: they insert the new task into the list immediately (optimistically) and then reconcile with a silent background refetch, so a new task appears instantly instead of after the list reloads. The dashboard also resets pagination to page 1.
- The navbar is responsive (`frontend/src/components/layout/navbar.tsx`). On pointer devices (`sm` and up) it is the hover-expanding floating pill. Below `sm`, where hover never fires, phones get a dedicated touch bar with a tap-to-open sheet menu — quick-add task input, navigation tabs with an active indicator, and account actions (Profile / Sign out) — reusing the same state and handlers as the pill. Both variants clear the iPhone status bar / Dynamic Island via `env(safe-area-inset-top)` (enabled by `viewport-fit=cover` in `app/layout.tsx`).
- Task list updates feel instant because mutation-triggered refetches run in "silent" mode (`fetchActiveTodos`/`fetchTodos` accept `{ silent }`): creating a task inserts it from the POST response right away, and create/reopen refreshes no longer flash the skeleton grid over existing cards. The first full page load still shows skeletons; only background reconciliation is silent.
- In the Task Branch edit modal, the title heading and its inline edit field share the exact same box model (padding, negative margin, border radius and font metrics), so clicking the title to rename it never shifts the heading sideways or changes its size — it simply fades from the hover background into an editable field.
- The Task Branch edit modal (`frontend/src/components/todos/edit-todo-modal`) is **quick-save** with no Save/Cancel buttons: editing the title, priority, due date, category, or visibility/sharing autosaves via the debounced `useAutosave` hook. Owners persist the full task payload; a shared viewer who can manage their own category autosaves only their private category preference. The description ("Author's Note" in the branch) keeps its own explicit editor and is intentionally excluded from the autosave equality check so it is never written twice. There is **no footer panel** — no autosave-status indicator and no `Done` button; the modal closes via the header **✕**, the backdrop, or `Escape`, and a pending edit is flushed on close/unmount. Save failures are toasted once; the autosave retries on the next edit.
- When the user removes a category during task edit, `applyCategoryPatch` (`frontend/src/utils/todo-utils.ts`) zeroes all four category fields (`categoryId`, `categoryName`, `categoryColor`, `categoryIcon`) in local state after the PUT — necessary because the backend treats `categoryId: null` as a no-op and echoes back the old values.
- Todo, dashboard, and completed-task pages enrich author names for public friend tasks as well as direct shared tasks.

## Task Workers ("In Progress")

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

Provide a persistent discussion timeline on public and shared tasks: user comments, the
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

A durable, per-user, per-task notification system: when anything happens in a task's branch (a new
message, a subtask, someone taking the task into work, a completion) every **other** participant —
never the actor — gets a notification in real time, shown as a labeled pill on the task card (a
tinted icon chip carrying a people/branch motif glyph, the human label, and the unread count — so a
glance reads *what happened and who/where*), an unread count by the branch composer, a header bell,
an in-app toast, and (for high-signal events) a native OS notification.

### Implementation

- Producers fan out one `NotificationEvent` per recipient (actor excluded) through their transactional
  outbox: `TodoApi/.../Common/NotificationFanout.cs` (wired into JoinTodo, CreateSubtask, UpdateTodo)
  and `CollaborationApi/.../AddComment` for messages/replies.
- `RealtimeApi/.../Handlers/NotificationEventHandler.cs` persists each event to the durable log
  (idempotent on the event id) via `NotificationStore`, then pushes the full shape over SignalR
  (`ReceiveNotification`). Read API: `NotificationReadStore` + `NotificationsController`
  (`summary` / list / `read`).
- Frontend: `store/notifications.ts` (read-model + optimistic mark-read), `lib/notifications/types.ts`
  (type → icon/tint/label/OS flag + people·branch·chat motif), `components/notifications/notification-badge.tsx`
  (`variant="pill"` — the labeled plate on the card; `variant="mark"` — the compact tinted disc on the
  branch composer), `notification-bell.tsx` (header center), `lib/notifications/web-notifications.ts` (OS),
  and the `useNotificationsLifecycle` hook in `lib/realtime/hooks.ts`.

### Key Rules

- **Actor exclusion:** a notification is only ever sent to participants *other than* the person who
  triggered the event — you never notify yourself, and never see a dot for your own action.
- **Recipients** = the task's audience (owner + shared-with + the owner's friends when public),
  resolved where the visibility model lives (`RealtimeAudience`), minus the actor.
- **Review milestone (author-only):** when every participant except the author has completed a
  public/shared task, the author gets `task.review` if **all subtasks are also done**, otherwise
  `task.participants_done` (the "people + check" mark). Fires once, only on the completion that
  crosses the threshold, and is suppressed if the author already closed the task themselves.
- **Read-on-view:** opening a task's branch (modal or `/branch/{id}`) marks its notifications read
  after a brief "seen" delay; opening a card marks them read immediately; reading a bell row marks
  that one. Read state is persisted, so the indicator stays inactive across reloads.
- **OS notifications** fire only for high-signal kinds (`comment.reply`, `task.completed`,
  `task.review`, `task.participants_done`) and only while the tab is backgrounded/unfocused (a focused
  user already has the toast). Permission is requested from a user gesture (first bell open).
- **Durable + idempotent:** persisted before fan-out (offline recipients are caught up on reconnect /
  tab focus); a redelivered event is stored and pushed at most once (unique `SourceEventId`).
- **Visual language:** the header dropdown is an **opaque** `bg-white` panel (no translucency), and the
  chrome stays in the app's grayscale (the "Mark all read" action and the bell's unread-count bubble are
  neutral `gray-500`/`gray-900`, the unread-row highlight is `gray-50`, not indigo). Per-kind icon tints
  follow a **semantic three-family scheme** — blues = communication/new, greens = completion, ambers =
  needs-attention — with a neutral slate fallback for unknown types (`lib/notifications/types.ts`).
- **Security:** every read/mark-read query is scoped to the JWT subject (no IDOR); live-sync signals
  remain content-free (the client refetches through authorized endpoints).
- `/api/v1/connections/active` returns only the current user's connections;
  `/api/v1/connections/stats` and `/notifications/broadcast` are admin-only. SignalR reads
  `access_token` from the query string for `/hubs` paths; Redis backplane channel prefix is `planora`.

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
  send, idle-cleared, and TTL-swept; the indicator reads "&lt;First Last&gt; is typing…" (multi-user aware).
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

## Sign-in And Create-account Screens

### Purpose

Get a returning person in, and a new one signed up, without spending their attention on
anything else.

### Implementation

- `frontend/src/app/auth/login/page.tsx`, `frontend/src/app/auth/register/page.tsx`
- `frontend/src/components/auth/auth-chrome.tsx` — the dark panel, the wordmark, the error banner
- `frontend/src/components/auth/password-input.tsx` — the password field and its reveal toggle
- `frontend/src/lib/password-policy.ts` — the password rule, declared once

### Key Rules

| Rule | Why |
|---|---|
| Neither screen grows | "Six times bigger" applies to the landing page. A sign-in page made six times bigger is six times worse; interactive targets stayed at 7 and 9 |
| The dark panel is `aria-hidden`, 2/5 wide, and holds one sentence | It is decorative. At half the viewport with six claims in it, the form was the smaller half of its own page, and a screen-reader user walked all of it before reaching the email field |
| The wordmark lives in the form column at every breakpoint | It used to be `lg:hidden`, taking its desktop appearance from the panel. With the panel hidden from assistive tech that would leave nothing saying where you are |
| One refusal, one message, one place | The banner carries `role="alert"`; the duplicate toast on the same failure is gone. A sighted reader saw the sentence twice and a screen-reader user heard it once with nothing left beside the field |
| A 409 lands on the email field | `Field` then marks it `aria-invalid` and announces it, instead of leaving the user to guess which of five fields the server meant |
| 401 and 400 say different things | 401 is wrong credentials; 400 is a malformed request, and reporting it as a bad password sends people to reset one that was never the problem |
| Two-factor is detected by error code | Substring sniffing on the message made the branch hostage to prose — reword the server's sentence and the client silently stops asking for the code |
| One password rule, in `lib/password-policy.ts` | Sign-in accepted `min(6)` while create-account required 8 plus four classes, so sign-in advertised a password that could not have been created |
| `confirmPassword` is never posted | It is an agreement between two fields; sending it transmitted the password twice |
| The strength meter animates `transform: scaleX` | It animated `width` — a layout property — over `deliberate` 480ms, four times the ceiling for a response to a keystroke |
| Create-account waits for the session restore | It had neither a hydration gate nor an authenticated redirect, so a signed-in visitor could sit on it indefinitely |

### Measured

Signed out (`--set public --mock --anon`), 9 viewports, production build:

| | `/auth/login` | `/auth/register` |
|---|---|---|
| Max CLS | 0.0011 | 0.0001 |
| Contrast failures | 0 | 0 |
| Unnamed controls | 0 | 0 |
| Focus stops without an indicator | 0 of 8 | 0 of 10 |
| Targets under 44×44 | 1 — `Create one`, a link inside a sentence | 1 — `Sign in`, the same exception |
| Console errors | 0 | 0 |

The remaining sub-44 targets are the WCAG 2.5.8 exception for a link within a sentence, and are
deliberate. The `Remember me` checkbox previously measured 16×16 and now carries `.touch-target`.

## The Landing Page

### Purpose

Say the one thing Planora does that a list app does not — a task carries the list of people who
can see it — and let a signed-out visitor verify it with their hands before making an account.

### Implementation

- `frontend/src/app/page.tsx` — the shell, a **server component**
- `frontend/src/app/_landing/` — the client islands, colocated with the route
- `frontend/src/lib/landing-audience.ts` — the audience derivation and the sharing ceiling

### Key Rules

| Rule | Why |
|---|---|
| The shell is a server component; `"use client"` lives in the islands | The `h1` is the LCP element. The previous version was `"use client"` end to end, which put it inside a tree waiting on hydration |
| Heavy blocks are `next/dynamic` with **`ssr` left on** | Turning SSR off swaps a placeholder for content after hydration, which is a layout shift |
| Every demo mounts the component the product ships | A copy diverges on the first change and the page starts lying about the product |
| `deriveAudience` never returns `public` | The editor writes `isPublic: false` on every save and no route serves a task to an anonymous reader, so a reachable `public` arc would be a plain lie |
| The closed ring appears once, via `showLabel={false}` with no `onClick` | That is the component's `aria-hidden` mark-only branch. The labelled variant announces "Public", which is false about every task in this product |
| Faces in the audience row are `Avatar`, **not** `PresenceRow` | `PresenceRow` is the worker primitive; its spoken sentence reads "… are working on this", which is false about an audience |
| One `useListNavigation` instance on the route | It is single-instance by construction: the first listener's `preventDefault()` makes a second list deaf |
| No second `ShortcutsOverlay` | `ShortcutsHelp` in `app/layout.tsx` already owns a global capture-phase `?`, so the key already works here |
| Fixtures are labelled as fixtures on screen | The product is not launched; invented people presented as customers would be fabricated social proof |

### Measured

Signed out, production build, 9 viewports (`--set public --mock --anon`):

| | Before | After |
|---|---|---|
| Meaningful blocks | 2 | 9 |
| Live demos | 0 | 5 |
| Interactive targets | 4 | 36 |
| Focus stops without a visible indicator | — | 0 of 37 |
| Headings | 1 `h1`, no `h2` | 1 `h1` + 8 `h2` + 6 `h3`, no level skips |
| CLS | 0.0007 | **0** at every viewport, in all three modes |
| LCP, median of 5 runs, worst viewport | — | 668 ms |

The LCP figure is a **median of five runs** on purpose: the same code measured 372, 2656, 372,
2708 and 380 ms at 1440 px, so a single run cannot separate a regression from noise.

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

## Automatic data cleanup (retention)

Confirmed behaviour once the retention subsystem is enabled (it ships disabled + dry-run — see
`configuration.md`):

- **Completed tasks auto-delete.** A task left completed for `CompletedTaskDays` (default 30) is deleted —
  through the same cascade as a manual delete, so its comment timeline and notifications go too, and the
  whole branch (all subtasks, any status) goes with the root. Shared/public tasks are deleted for everyone
  once the owner's completion is ≥30 days old; a task a friend completed only for themselves (owner still
  active) is instead hidden from that friend after 30 days. The completed archive shows a small
  "удалится через N дн." badge on tasks that are on the delete path.
- **Soft-deleted data is really deleted.** Anything soft-deleted (task, category, comment, …) is physically
  removed `SoftDeleteGraceDays` (default 7) later — the grace window doubles as an undo/recovery window.
- **Notifications expire.** A read notification is removed `ReadNotificationDays` (default 3) after it was
  read; an unread one after `UnreadNotificationDays` (default 90). Deleting a task or user also removes its
  notifications immediately.
- **Housekeeping.** Processed outbox/inbox messages (7 days) and long-expired refresh tokens (30 days past
  expiry) are reaped. Login history (180 days) and audit logs (365 days) are opt-in (forensics).
