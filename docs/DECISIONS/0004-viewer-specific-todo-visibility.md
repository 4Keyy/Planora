# ADR 0004: Viewer-Specific Todo Visibility

## Status

Accepted.

## Context

Shared todos need per-viewer hidden state and optional viewer-specific category assignment. A viewer hiding a shared task should not expose the owner's title, description, tags, dates, shared users, or completion metadata through list responses.

## Decision

Represent shared/public task visibility through `UserTodoViewPreference`.

For hidden shared/public tasks:

- List and detail handlers return redacted `TodoItemDto`.
- Non-owner `UserId` is `Guid.Empty`.
- Title is `Hidden task`.
- Description, tags, shared users, due/expected/actual/completed metadata are omitted/null/default.
- Category ID/name/color/icon remain available so the collapsed card can be filtered by the viewer's category.
- Frontend does not eagerly hydrate hidden tasks on initial list load.
- Detail fetch happens only after explicit reveal/unhide.
- During reveal, the frontend keeps the redacted card collapsed until the detail fetch returns, so the redacted DTO is never rendered as an expanded intermediate card.

## Consequences

### Implementation Note — 2026-10-06

`HiddenTodoDtoFactory.ShouldMask` also masks the owner's hidden task when it has a public
or explicit shared audience. A private owner's hidden task remains readable. Shared owners
use `HiddenByViewer || TodoItem.Hidden` for compatibility; non-owners use their own
preference only. The owner hide endpoint clears a legacy shared global hidden flag when
updating their preference.

The preference record additionally holds per-viewer completion. Global owner completion
closes a task for every viewer; owner reopening clears viewer completion on shared/public
tasks. A viewer can clear personal completion while the owner has not globally completed
the task. This differs from the frontend's stricter author-only reopen action.

Redaction is applied by list/detail read paths, not automatically by every DTO mapper.
The current public-task join path returns a full mapped DTO and omits the live friendship
check; this known inconsistency is documented in [auth-security.md](../auth-security.md).
Do not interpret this ADR as proof that every mutation response is redacted.

### Original Tradeoffs

Positive:

- Privacy is enforced server-side, not just in the UI.
- The UI can keep hidden cards collapsed and category-filterable.
- Reveal is auditable as an explicit user action.

Tradeoffs:

- Redacted DTOs contain intentionally empty/default values for required fields.
- Frontend logic must avoid treating redacted metadata as real task metadata.
- Tests must cover both backend redaction and frontend no-eager-hydration behavior.
