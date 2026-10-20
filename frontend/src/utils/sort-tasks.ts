/**
 * Active lists sort by urgency/priority/shared/regular band, then open before hidden, then
 * the smart key within that group. Completed tasks follow every active band.
 */

import { TodoPriority, isTodoOwner } from "@/types/todo"
import { addDays, calendarDayOf, endOfWeek, localDay, type CalendarDay } from "@/lib/calendar-date"

/** Where a task sorts: compared element by element, smaller first. See `ownKey`. */
export type SortKey = readonly number[]

/** The signed-in viewer's id, when known. */
type Viewer = string | null | undefined

/**
 * The place a card opened from hidden keeps (`keepPlace`): the key it was placed by while it was
 * hidden within its band, and the key its full copy is placed by.
 */
export type HeldPlace = { place: SortKey; open: SortKey }

export type SortableTask = {
  id: string
  /** The owner — whose "in progress" makes a task the viewer's own work (`taskIsWorkingOn`). */
  userId?: string | null
  title?: string | null
  description?: string | null
  priority?: TodoPriority | string | null
  dueDate?: string | null
  createdAt: string
  isCompleted?: boolean
  status?: string | null
  completedAt?: string | null
  hidden?: boolean | null
  /**
   * The server's word on the card's red frame (`TodoViewerStateResolver.IsVisuallyUrgent`): the
   * one sign of urgency a hidden task keeps, its date being withheld.
   */
  isVisuallyUrgent?: boolean | null
  hasSharedAudience?: boolean | null
  isPublic?: boolean | null
  sharedWithUserIds?: readonly string[] | null
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

/**
 * The viewer's own work, as the card glows for it (`todo-card.tsx`) and as the API orders it:
 * their own task in progress, or someone else's they joined (`isWorking`). A friend's task the
 * friend is working on is not the viewer's work. Without a known viewer or owner, either sign
 * counts.
 */
function taskIsWorkingOn(task: SortableTask, viewerId: string | null | undefined): boolean {
  const inProgress = String(task.status ?? "").toLowerCase().replace(/\s/g, "") === "inprogress"
  if (!viewerId || !task.userId) return Boolean(task.isWorking) || inProgress
  return isTodoOwner({ userId: task.userId }, viewerId) ? inProgress : Boolean(task.isWorking)
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

// "Today" is the viewer's local calendar day; a due date is the calendar day it names
// (lib/calendar-date) — read in local time it fell a day early west of UTC.
const todayStart = (): CalendarDay => localDay()

// ─── date bucket ──────────────────────────────────────────────────────────────
// 0 = overdue          (due < today)          → most overdue first
// 1 = today            (due == today)
// 2 = tomorrow         (due == today + 1 day)
// 3 = this week        (after tomorrow, within the current Mon–Sun week)
// 4 = future           (beyond this week)     → soonest first
// 5 = no due date      → sorted by priority only

function dateBucket(due: Date | null, today: CalendarDay): number {
  const dueDay = calendarDayOf(due)
  if (!dueDay) return 5

  if (dueDay < today) return 0 // overdue
  if (dueDay === today) return 1 // today
  if (dueDay === addDays(today, 1)) return 2 // tomorrow
  // The rest of the current Monday-to-Sunday week, after tomorrow.
  if (dueDay <= endOfWeek(today)) return 3
  return 4 // future
}

// ─── main sort key ─────────────────────────────────────────────────────────────
// Working tasks lead within their band and visibility group; date buckets and priority
// retain the smart order, with newer creation times breaking otherwise equal keys.

function sortKey(task: SortableTask, today: CalendarDay, viewerId: Viewer): [number, number, number, number, number] {
  const due       = parseDue(task)
  const db        = dateBucket(due, today)
  const dateMs    = due ? due.getTime() : Infinity
  const createdMs = parseCreated(task)

  // "In work" tasks (owner's InProgress OR non-owner joined) lead their group
  if (taskIsWorkingOn(task, viewerId)) {
    // Same internal sort rules apply within the working group
    if (db <= 2) return [0, db, priorityRank(task), dateMs, -createdMs]
    return [0, 3, dateMs, priorityRank(task), -createdMs]
  }

  // All other active tasks
  if (db <= 2) return [1, db, priorityRank(task), dateMs, -createdMs]
  return [1, 3, dateMs, priorityRank(task), -createdMs]
}

/**
 * Urgent, the way the card draws it: its red frame. The server's flag when there is one (a
 * hidden task has nothing else), otherwise the card's own rule — Urgent, overdue or due today.
 */
function taskIsUrgent(task: SortableTask, today: CalendarDay): boolean {
  if (taskIsCompleted(task)) return false
  if (task.isVisuallyUrgent != null) return task.isVisuallyUrgent
  return priorityRank(task) === 0 || dateBucket(parseDue(task), today) <= 1
}

// ─── bands ────────────────────────────────────────────────────────────────────
// Urgency wins over High priority, which wins over shared audience. Hidden state only
// separates tasks within a band, so hidden urgency stays ahead of open High tasks.

/** A task's own place: band, hidden flag, then smart key; completed tasks form the last band. */
function ownKey(task: SortableTask, today: CalendarDay, viewerId: Viewer): SortKey {
  if (taskIsCompleted(task)) return [4, 0, -parseCompleted(task)]
  const band = taskIsUrgent(task, today) ? 0
    : priorityRank(task) <= 1 ? 1
    : (task.hasSharedAudience ?? (task.isPublic === true || (task.sharedWithUserIds?.length ?? 0) > 0)) ? 2
    : 3
  return [band, task.hidden ? 1 : 0, ...sortKey(task, today, viewerId)]
}

const sameKey = (a: SortKey, b: SortKey) => a.length === b.length && a.every((value, i) => value === b[i])

function compareKeys(a: SortKey, b: SortKey): number {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return a.length - b.length
}

/** The key a task is placed by: its own, unless it still holds the place it was opened in. */
function placeKey(task: SortableTask, today: CalendarDay, viewerId: Viewer): SortKey {
  const key = ownKey(task, today, viewerId)
  const held = task.heldPlace
  return held && sameKey(key, held.open) ? held.place : key
}

// ─── public API ───────────────────────────────────────────────────────────────

/**
 * Opening a hidden card never moves it.
 *
 * A hidden card sorts after the open tasks in its own band (`sortTasks`), and the server
 * sends it without what would place it among those — no due date, and for a task with an
 * audience not even its status or when it was made. Opening it brings the rest, and the full
 * copy sorts somewhere else: the card opened and then flew off to its date's place, as far as
 * 800px up the list, with the keyboard's focus dragging the page after it on a phone (measured,
 * 2026-10-12).
 *
 * The opened copy keeps the place the hidden one had, for as long as nothing that decides its
 * place changes: a new priority, a due date, being taken into work — anything that changes its
 * key — sends it where it belongs, as it would any card. A copy fresh from the server (the next
 * time the list loads) carries no held place and sorts by its own key.
 */
export function keepPlace(before: SortableTask, after: SortableTask, viewerId?: Viewer): HeldPlace {
  const today = todayStart()
  return { place: placeKey(before, today, viewerId), open: ownKey(after, today, viewerId) }
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
 * Task list order (front to back):
 *  1. URGENT (server urgency flag, else Urgent/overdue/today), PRIORITY (High or higher),
 *     SHARED (server audience flag, else public/shared users), then REGULAR.
 *  2. Open tasks before hidden tasks inside each band.
 *  3. Within each band and visibility group, the viewer's own work first, then the existing
 *     smart date buckets and priority order; newer creation times break otherwise equal keys.
 *     A hidden copy carries no date, so it sorts as undated.
 *  4. Completed tasks last, most recently completed first.
 *
 * A card opened from hidden keeps the place within its band that it was
 * opened in (`keepPlace`). Never mutates the original array; equal keys keep their input order.
 *
 * The Todo API orders the active list the same way before it pages it (`TodoRepository`), so
 * a page of the Dashboard holds the tasks Tasks shows in that place; one fixture pins both
 * (`tests/fixtures/active-list-order.json`). `viewerId` decides whose work a task in progress is.
 */
export function sortTasks<T extends SortableTask>(tasks: T[], viewerId?: Viewer): T[] {
  const today = todayStart()
  const placed = tasks.map((task) => ({ task, key: placeKey(task, today, viewerId) }))
  placed.sort((a, b) => compareKeys(a.key, b.key))

  return placed.map((p) => p.task)
}
