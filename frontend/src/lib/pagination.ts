/**
 * Which page numbers a pager shows: the first, the last, the current one and its two
 * neighbours, with a gap marker wherever numbers are skipped.
 *
 *   pageWindow(1, 2)  → [1, 2]
 *   pageWindow(5, 10) → [1, "gap", 4, 5, 6, "gap", 10]
 *
 * A gap that would stand for a single page shows that page instead: "1 … 3" hides
 * exactly one number, and the marker takes as much room as the number would.
 */
export type PageSlot = number | "gap"

export function pageWindow(current: number, total: number): PageSlot[] {
  if (total <= 0) return []
  const page = Math.min(Math.max(1, Math.round(current)), total)
  const wanted = new Set([1, total, page - 1, page, page + 1].filter((n) => n >= 1 && n <= total))
  const sorted = [...wanted].sort((a, b) => a - b)
  const slots: PageSlot[] = []
  sorted.forEach((n, i) => {
    const previous = sorted[i - 1]
    if (previous !== undefined && n - previous === 2) slots.push(previous + 1)
    else if (previous !== undefined && n - previous > 2) slots.push("gap")
    slots.push(n)
  })
  return slots
}
