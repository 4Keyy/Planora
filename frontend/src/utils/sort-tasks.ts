import { TodoPriority } from "@/types/todo"

export type SortableTask = {
  id: string
  title?: string | null
  description?: string | null
  priority?: TodoPriority | string | null
  dueDate?: string | null
  createdAt: string
  isCompleted?: boolean
  status?: string | null
  completedAt?: string | null
  hidden?: boolean | null
  isWorking?: boolean | null
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function taskIsCompleted(task: SortableTask): boolean {
  if (task.isCompleted) return true
  const s = String(task.status ?? "").toLowerCase()
  return s === "done" || s === "completed"
}

// Owner: status = "inprogress" / "in progress"; non-owner: isWorking flag
function taskIsWorkingOn(task: SortableTask): boolean {
  if (task.isWorking) return true
  return String(task.status ?? "").toLowerCase().replace(/\s/g, "") === "inprogress"
}

function priorityRank(task: SortableTask): number {
  const p = String(task.priority ?? "")
  // lower = shown first
  if (p === TodoPriority.Urgent || p === "Critical" || p === "5") return 0
  if (p === TodoPriority.High   || p === "4")                       return 1
  if (p === TodoPriority.Medium || p === "3")                       return 2
  if (p === TodoPriority.Low    || p === "2")                       return 3
  if (p === TodoPriority.VeryLow || p === "1")                      return 4
  return 5 // no priority
}

function parseDue(task: SortableTask): Date | null {
  if (!task.dueDate) return null
  const d = new Date(task.dueDate)
  return isNaN(d.getTime()) ? null : d
}

function parseCreated(task: SortableTask): number {
  const d = new Date(task.createdAt)
  return isNaN(d.getTime()) ? 0 : d.getTime()
}

function parseCompleted(task: SortableTask): number {
  if (!task.completedAt) return 0
  const d = new Date(task.completedAt)
  return isNaN(d.getTime()) ? 0 : d.getTime()
}

function todayStart(): Date {
  const n = new Date()
  return new Date(n.getFullYear(), n.getMonth(), n.getDate())
}

// ─── date bucket ──────────────────────────────────────────────────────────────
// 0 = overdue          (due < today)          → most overdue first
// 1 = today            (due == today)
// 2 = tomorrow         (due == today + 1 day)
// 3 = this week        (after tomorrow, within the current Mon–Sun week)
// 4 = future           (beyond this week)     → soonest first
// 5 = no due date      → sorted by priority only

function dateBucket(due: Date | null, today: Date): number {
  if (!due) return 5

  // Normalise the due date to midnight local so we can compare dates only
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate())

  if (dueDay < today) return 0 // overdue

  // tomorrow = today + 1 day
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)

  if (dueDay.getTime() === today.getTime()) return 1 // today
  if (dueDay.getTime() === tomorrow.getTime()) return 2 // tomorrow

  // End of the current calendar week (Sunday), using Mon = start of week.
  // today.getDay(): 0=Sun,1=Mon,...,6=Sat
  // Days remaining until (and including) Sunday of this week (Mon–Sun):
  //   if today is Sunday (0): days until Sunday = 0 → endOfWeek = today
  //   if today is Monday (1): days until Sunday = 6
  //   if today is Saturday (6): days until Sunday = 1
  const daysUntilSunday = (7 - today.getDay()) % 7
  const endOfWeek = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() + daysUntilSunday
  )

  if (dueDay <= endOfWeek) return 3 // this week (after tomorrow, within week)

  return 4 // future
}

// ─── main sort key ─────────────────────────────────────────────────────────────
// Returns a tuple [statusBucket, dateBucket, dateMs, priorityRank]
// Tuples are compared element-by-element to produce the final order.

function sortKey(task: SortableTask, today: Date): [number, number, number, number, number] {
  // Completed — always at the bottom, newest completions first
  if (taskIsCompleted(task)) return [2, 0, 0, 0, -parseCompleted(task)]

  const due       = parseDue(task)
  const db        = dateBucket(due, today)
  const dateMs    = due ? due.getTime() : Infinity
  const createdMs = parseCreated(task)

  // "In work" tasks (owner's InProgress OR non-owner joined) always sort first
  if (taskIsWorkingOn(task)) {
    // Same internal sort rules apply within the working group
    if (db <= 2) return [0, db, priorityRank(task), dateMs, createdMs]
    return [0, 3, dateMs, priorityRank(task), createdMs]
  }

  // All other active tasks
  if (db <= 2) return [1, db, priorityRank(task), dateMs, createdMs]
  return [1, 3, dateMs, priorityRank(task), createdMs]
}

// ─── public API ───────────────────────────────────────────────────────────────

/**
 * Estimates the visual height/weight of a task card for masonry balancing.
 */
export function getTaskWeight(task: SortableTask): number {
  if (task.hidden) return 80 // Collapsed state is small but has padding

  let weight = 160 // Base height for a standard card (title, padding, borders)

  if (task.title && task.title.length > 25) {
    weight += 30 // Second line of title
  }

  if (task.description) {
    const descLen = task.description.length
    // Every ~40 chars is roughly a line of text (24px line-height)
    // We cap it at 3 lines for the weight estimate
    weight += Math.min(72, Math.ceil(descLen / 40) * 24)
  }

  // Tags/Badges row (always present in the UI if there's a category or public flag)
  weight += 30

  if (task.dueDate || task.status === "InProgress") {
    weight += 40 // Date/Status row with icon
  }

  return weight
}

/**
 * Smart sort order (front to back):
 *  1. By due-date bucket:
 *       a. Overdue (most overdue first — smallest date first)
 *       b. Due today
 *       c. Due tomorrow
 *       d. Due this week (after tomorrow, within the current Mon–Sun week)
 *       e. Future (beyond this week, soonest first)
 *       f. No due date (sorted by priority only — see step 2)
 *  2. Within the same date bucket: Urgent → High → Medium → Low → VeryLow → None
 *  3. Completed tasks — most recently completed first
 *  4. Hidden tasks — no longer special (they stay in their place)
 *
 * Never mutates the original array.
 */
export function sortTasks<T extends SortableTask>(tasks: T[]): T[] {
  const today = todayStart()

  return [...tasks].sort((a, b) => {
    const ka = sortKey(a, today)
    const kb = sortKey(b, today)

    for (let i = 0; i < ka.length; i++) {
      if (ka[i] !== kb[i]) return ka[i] - kb[i]
    }
    return 0
  })
}
