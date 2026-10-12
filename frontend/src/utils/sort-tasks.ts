import { TodoPriority } from "@/types/todo"

/** Where a task sorts: compared element by element, smaller first. See `sortKey`. */
export type SortKey = readonly number[]

/**
 * The place a card opened from hidden keeps (`keepPlace`): the key it sorted by while it was
 * hidden, and the key its full copy sorts by.
 */
export type HeldPlace = { hidden: SortKey; open: SortKey }

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
  expectedDate?: string | null
  delay?: string | null
  /** Client-only — see `keepPlace`. A copy fresh from the server carries none. */
  heldPlace?: HeldPlace | null
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

const sameKey = (a: SortKey, b: SortKey) => a.length === b.length && a.every((value, i) => value === b[i])

/** The key a task is placed by: its own, unless it still holds the place it was opened in. */
function placeKey(task: SortableTask, today: Date): SortKey {
  const key = sortKey(task, today)
  const held = task.heldPlace
  return held && sameKey(key, held.open) ? held.hidden : key
}

// ─── public API ───────────────────────────────────────────────────────────────

/**
 * Opening a hidden card never moves it.
 *
 * The server sends a hidden task without what would place it — no due date, and for a task with
 * an audience not even its status or when it was made — so a hidden card sorts as though it had
 * no date. Opening it brings the rest, and the full copy sorted somewhere else: the card opened
 * and then flew off to its date's place, as far as 800px up the list, with the keyboard's focus
 * dragging the page after it on a phone (measured, 2026-10-12).
 *
 * The opened copy keeps the place the hidden one had, for as long as nothing that decides its
 * place changes: a new priority, a due date, being taken into work — anything that changes its
 * key — sends it where it belongs, as it would any card. A copy fresh from the server (the next
 * time the list loads) carries no held place and sorts by its own key.
 */
export function keepPlace(before: SortableTask, after: SortableTask): HeldPlace {
  const today = todayStart()
  return { hidden: placeKey(before, today), open: sortKey(after, today) }
}

/** A card's frame: its 1px border and 20px of padding, top and bottom. */
const CARD_FRAME = 42
/** A title line: `title-sm` at `leading-snug` from `sm` up (20px x 1.375). */
const TITLE_LINE = 27.5
/** About how many characters fit a title line in a three- or four-column grid. */
const TITLE_CHARS_PER_LINE = 26
/** And a description line (`body-sm`, 20px), which is smaller type. */
const DESCRIPTION_CHARS_PER_LINE = 40

/**
 * A task card's height in px, estimated from what it holds, for dealing the masonry columns.
 *
 * It follows the card's real geometry (`components/todos/todo-card.tsx`): the frame round a
 * body of a title (up to three lines), the chip row under it, then whatever else the task
 * carries — two lines of description, the due date, the expected/delay strip. There is no
 * height floor: a card is as short as its content, down to the 32px completion circle.
 * A hidden card is its one collapsed row; a completed one is its title alone. The deal only
 * needs these to be right relative to each other, and they are now the cards' own sizes
 * rather than a 160px base that a sparse card never reached.
 */
export function getTaskWeight(task: SortableTask): number {
  const completed = taskIsCompleted(task)
  // py-2 round the collapsed row, whose tallest piece is the 28px expand toggle.
  if (task.hidden && !completed) return 46

  const titleLines = Math.min(3, Math.max(1, Math.ceil((task.title?.trim().length ?? 0) / TITLE_CHARS_PER_LINE)))
  let body = titleLines * TITLE_LINE
  if (completed) return CARD_FRAME + Math.max(32, body)

  body += 12 + 24 // the chip row, a column gap below the title
  if (task.description) {
    body += 12 + Math.min(2, Math.ceil(task.description.trim().length / DESCRIPTION_CHARS_PER_LINE)) * 20
  }
  if (task.dueDate) body += 12 + 16
  if (task.expectedDate || task.delay) body += 16 + 1 + 16 + 24 // ruled strip of chips
  return CARD_FRAME + Math.max(32, body)
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
 *  4. Hidden tasks — no longer special (they stay in their place), and a card opened from
 *     hidden keeps the place it was opened in (`keepPlace`)
 *
 * Never mutates the original array.
 */
export function sortTasks<T extends SortableTask>(tasks: T[]): T[] {
  const today = todayStart()

  return [...tasks].sort((a, b) => {
    const ka = placeKey(a, today)
    const kb = placeKey(b, today)

    for (let i = 0; i < ka.length; i++) {
      if (ka[i] !== kb[i]) return ka[i] - kb[i]
    }
    return 0
  })
}
