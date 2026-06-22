/**
 * Shared copy + helpers for the "this task still has unfinished subtasks — finish it anyway?"
 * confirmation. Surfaced from both completion entry points (the card's quick-complete and the
 * branch modal's "Complete task" action) so the warning reads identically everywhere.
 */

/** Russian plural for "невыполненная под-задача" agreeing with {@link n}. */
export function incompleteSubtaskWord(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return "невыполненная под-задача"
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "невыполненные под-задачи"
  return "невыполненных под-задач"
}

/** Static labels for the confirmation dialog (title + buttons + "don't show again"). */
export const INCOMPLETE_SUBTASK_DIALOG = {
  title: "Остались невыполненные под-задачи",
  confirmText: "Выполнить",
  cancelText: "Продолжить работу",
  dontAskAgainLabel: "Больше не показывать это окно",
} as const

/** Count-aware body copy for the confirmation dialog. */
export function incompleteSubtaskDescription(count: number): string {
  return `В этой задаче ещё ${count} ${incompleteSubtaskWord(count)}. ` +
    "Завершить задачу сейчас или продолжить работу над ними?"
}
