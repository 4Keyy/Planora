/**
 * Translate the completed-archive date picker's selection into the inclusive
 * `completedFrom`/`completedTo` query window the Todo API expects.
 *
 * The picker mirrors the estimated-completion date model (a `DueRange`): a lone
 * target day lives in `end` (with `start` empty), while an interval fills both
 * bounds with `start ≤ end`. Empty strings mean "no filter".
 *
 * Each bound is widened to the user's **local** day edges (start-of-day →
 * end-of-day) and then serialized as a UTC instant, so a single calendar day
 * matches every task finished on that day regardless of the stored time-of-day.
 * The server normalizes the instants back to UTC before comparing `CompletedAt`.
 *
 * @param start ISO `YYYY-MM-DD` start of an interval, or "" for a single day / no filter.
 * @param end   ISO `YYYY-MM-DD` single target day / later bound, or "" for no filter.
 * @returns `{ completedFrom?, completedTo? }` — empty object when nothing is selected.
 */
export function buildCompletionWindow(
  start: string,
  end: string,
): { completedFrom?: string; completedTo?: string } {
  // The earliest selected day is `start` when an interval exists, otherwise the
  // single day held in `end`. The latest is always `end`.
  const fromDay = start || end
  const toDay = end

  const window: { completedFrom?: string; completedTo?: string } = {}
  if (fromDay) window.completedFrom = new Date(`${fromDay}T00:00:00.000`).toISOString()
  if (toDay) window.completedTo = new Date(`${toDay}T23:59:59.999`).toISOString()
  return window
}
