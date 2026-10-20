/**
 * Text limits the server enforces, in one place so every editor counts against the same numbers
 * (`frontend/src/test/quality/text-limits.contract.test.ts` reads the validators and fails when
 * these drift). A limit below the server's is a product choice; one above it lets people type
 * what the server then rejects — the Author's Note and the New task details once allowed 5000
 * characters against a 2000-character column.
 */

/** A task's title — `CreateTodoCommandValidator` (200). The task editor keeps the same cap. */
export const TASK_TITLE_MAX = 200

/**
 * A task's description, which the branch shows as its Author's Note —
 * `CreateTodoCommandValidator`, `UpdateTodoCommandValidator` and the column (2000).
 */
export const TASK_DESCRIPTION_MAX = 2000

/** A subtask's title — `CreateSubtaskCommandValidator` (1500). */
export const SUBTASK_TITLE_MAX = 1500

/** A branch message — `AddCommentCommandValidator` / `UpdateCommentCommandValidator` (2000). */
export const COMMENT_MAX = 2000
