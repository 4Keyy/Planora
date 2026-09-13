/**
 * Shared copy + helpers for the "this task still has unfinished subtasks — finish it anyway?"
 * confirmation. Surfaced from both completion entry points (the card's quick-complete and the
 * branch modal's "Complete task" action) so the warning reads identically everywhere.
 *
 * The product ships in English (`<html lang="en">`); this module used to hold the last
 * Russian-language dialog in the UI, complete with a Slavic plural table. English needs only
 * the singular/plural split, so the table is gone with it.
 */

/** "subtask" or "subtasks", agreeing with {@link n}. */
export function incompleteSubtaskWord(n: number): string {
  return n === 1 ? "subtask" : "subtasks"
}

/** Static labels for the confirmation dialog (title + buttons + "don't show again"). */
export const INCOMPLETE_SUBTASK_DIALOG = {
  title: "Some subtasks are still open",
  confirmText: "Complete anyway",
  cancelText: "Keep working",
  dontAskAgainLabel: "Don't ask me again",
} as const

/** Count-aware body copy for the confirmation dialog. */
export function incompleteSubtaskDescription(count: number): string {
  return `This task still has ${count} unfinished ${incompleteSubtaskWord(count)}. ` +
    "Complete it now, or keep working on them?"
}
