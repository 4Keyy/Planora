/**
 * Countdown to a completed task's automatic deletion.
 *
 * The backend auto-deletes a task that has sat completed for
 * `Retention:CompletedTaskDays` days (see CompletedTodoPolicy), on a pass that runs every
 * hour — so a task leaves within the hour its window ends. This mirrors that default so
 * the completed-archive can show a gentle "deletes in N days" hint. It is only a hint —
 * the backend is authoritative — so a small drift if the server window is retuned is
 * cosmetic, not a correctness bug. Keep this constant in sync with the backend default
 * (`Retention__CompletedTaskDays`, default 30).
 */
export const COMPLETED_TASK_RETENTION_DAYS = 30

const MS_PER_DAY = 24 * 60 * 60 * 1000

export interface DeletionCountdown {
  /**
   * Calendar days until deletion in the reader's time zone: 0 for today (including a window
   * that has already ended and is waiting for the next hourly pass), 1 for tomorrow.
   */
  daysLeft: number
  /** The instant the task becomes eligible for auto-deletion. */
  deleteAt: Date
}

/**
 * Given when a task became completed for the reader, return when it will be auto-deleted and
 * how many days remain. For a friend's task the reader completed only for themselves that is
 * their own completion time (the API reports it as `completedAt`): retention removes such a
 * task from the reader's lists after the same window. Returns `null` when there is nothing to
 * show:
 *  - no `completedAt` (the task is not completed for this reader), or
 *  - an unparseable timestamp.
 */
export function getDeletionCountdown(
  completedAt: string | null | undefined,
  retentionDays: number = COMPLETED_TASK_RETENTION_DAYS,
  now: Date = new Date(),
): DeletionCountdown | null {
  if (!completedAt) return null

  const completed = new Date(completedAt)
  if (Number.isNaN(completed.getTime())) return null

  const deleteAt = new Date(completed.getTime() + retentionDays * MS_PER_DAY)
  // Calendar days, not 24-hour blocks. Rounding the remaining hours up used to say "deletes
  // tomorrow" for a task leaving at six this evening, and "deletes today" only once its window
  // had already passed. `round` absorbs the 23- and 25-hour days around a clock change.
  const daysLeft = Math.max(0, Math.round((startOfLocalDay(deleteAt) - startOfLocalDay(now)) / MS_PER_DAY))

  return { daysLeft, deleteAt }
}

function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}
