import { isCompletedTodoStatus, toApiTodoStatus, type Todo } from "@/types/todo"
import { getPriorityNumber } from "@/components/todos/edit-todo-modal/utils"
import { UI_LOCALE } from "@/lib/datetime"

/**
 * The palette's search, as plain functions: folding, fuzzy matching with the
 * positions it matched (so the row can mark them), the query's operators, the
 * smart views, and the due-date wording. Nothing here touches React or the DOM,
 * so every rule the palette ranks by is unit-tested on its own.
 */

// ─── Folding ────────────────────────────────────────────────────────────────

/**
 * One character, lower-cased and without its accent — "É" → "e", "Ё" → "е". It
 * keeps the character's length, so a position found in the folded text is the
 * same position in the original and the row can highlight exactly what matched.
 */
function foldChar(ch: string): string {
  const base = ch.normalize("NFD").replace(/\p{M}/gu, "") || ch
  const lower = base.toLowerCase()
  return lower.length === ch.length ? lower : ch
}

/** Case- and accent-insensitive form of `text`, the same length as `text`. */
export function fold(text: string): string {
  let out = ""
  for (const ch of text) out += foldChar(ch)
  return out
}

const isBoundary = (ch: string | undefined) => ch === undefined || /[\s\-_/.,:;()[\]"'«»#@]/.test(ch)

// ─── Fuzzy matching ─────────────────────────────────────────────────────────

export interface Match {
  /** Lower is better. */
  score: number
  /** Positions in the original text that matched, ascending. */
  indices: number[]
}

/**
 * Where `needle` occurs in `haystack`, preferring an occurrence at the start of a
 * word: "fl" should land on "FLights", not on the "fl" inside "conflict".
 */
function findRun(haystack: string, needle: string): number {
  let first = -1
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
    if (isBoundary(haystack[at - 1])) return at
    if (first === -1) first = at
  }
  return first
}

/**
 * Matches `needle` inside `haystack`, case- and accent-insensitively.
 *
 * A contiguous run wins outright, and one starting a word wins over one inside a
 * word. Failing that, the needle may be a subsequence — "bfl" finds "Book the
 * FLights" — scored by how scattered it is, so a short query still lands on the
 * obvious task first. Returns null when the letters are not there in order.
 */
export function fuzzyMatch(haystack: string, needle: string): Match | null {
  if (!needle) return { score: 0, indices: [] }
  const h = fold(haystack)
  const n = fold(needle)

  const run = findRun(h, n)
  if (run !== -1) {
    const indices = Array.from({ length: n.length }, (_, i) => run + i)
    return { score: (isBoundary(h[run - 1]) ? 0 : 6) + run * 0.05, indices }
  }

  let score = 20
  let from = 0
  let last = -2
  const indices: number[] = []
  for (const ch of n) {
    const found = h.indexOf(ch, from)
    if (found === -1) return null
    const adjacent = found === last + 1
    if (!adjacent) score += 8
    if (!adjacent && !isBoundary(h[found - 1])) score += 4
    score += (found - from) * 0.5
    indices.push(found)
    last = found
    from = found + 1
  }
  return { score, indices }
}

/** Merges matched positions into `[start, end)` ranges, for highlighting. */
export function toRanges(indices: number[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  for (const i of [...indices].sort((a, b) => a - b)) {
    const last = ranges[ranges.length - 1]
    if (last && last[1] === i) last[1] = i + 1
    else if (!last || last[1] < i) ranges.push([i, i + 1])
  }
  return ranges
}

// ─── The query ──────────────────────────────────────────────────────────────

/** Which kind of result a leading operator narrows the search to. */
export type Narrow = "categories" | "people" | "shortcuts"

export const OPERATORS: Record<string, Narrow> = { "#": "categories", "@": "people", ">": "shortcuts" }

export interface ParsedQuery {
  /** Set by a leading `#`, `@` or `>`. */
  narrow: Narrow | null
  /** The text without its operator, trimmed. */
  text: string
  /** Whitespace-separated words; every one of them has to match. */
  tokens: string[]
}

export function parseQuery(raw: string): ParsedQuery {
  const trimmed = raw.trimStart()
  const narrow = OPERATORS[trimmed[0] ?? ""] ?? null
  const text = (narrow ? trimmed.slice(1) : trimmed).trim()
  return { narrow, text, tokens: text ? text.split(/\s+/) : [] }
}

// ─── Tasks ──────────────────────────────────────────────────────────────────

export interface PaletteTask {
  id: string
  title: string
  description: string | null
  completed: boolean
  completedAt: string | null
  inProgress: boolean
  dueDate: string | null
  dueDateStart: string | null
  /** 1 (very low) … 5 (urgent). */
  priority: number
  categoryId: string | null
  categoryName: string | null
  categoryColor: string | null
  categoryIcon: string | null
  /** True for the viewer's own task; false for one a friend shared. */
  mine: boolean
  ownerId: string
  ownerName: string | null
  /** Shared with every accepted friend. */
  sharedWithAll: boolean
  sharedWith: string[]
  workers: Array<{ id: string; name: string | null }>
  openSubtasks: number
  urgent: boolean
  /**
   * Hidden by the viewer. It can still be found, but its row stays blurred until it
   * is pointed at, and it is never recommended — "Up next" leaves it out.
   */
  hidden: boolean
  /** Folded description, category and people names: matched as whole words, never as scattered letters. */
  keywords: string
}

/**
 * The palette's view of a task. `names` resolves a user id to a display name
 * (friends, plus the API's own `authorName`), so a search for "ada" finds the
 * tasks Ada shares, works on or is shared with.
 */
export function toPaletteTask(todo: Todo, viewerId: string | null, names: Map<string, string>): PaletteTask {
  const completed = Boolean(todo.isCompleted) || isCompletedTodoStatus(todo.status)
  const mine = viewerId === null || todo.userId === viewerId
  const sharedWith = todo.sharedWithUserIds ?? []
  // A list read carries worker ids; only a subtask read carries their names.
  const named = new Map((todo.workers ?? []).map((w) => [w.userId, w.name ?? null]))
  const workerIds = todo.workers?.length ? todo.workers.map((w) => w.userId) : (todo.workerUserIds ?? [])
  const workers = workerIds.map((id) => ({
    id,
    name: id === viewerId ? "You" : (named.get(id) ?? names.get(id) ?? null),
  }))
  const ownerName = mine ? null : (todo.authorName ?? names.get(todo.userId) ?? null)
  const categoryName = todo.categoryName ?? null
  const people = [
    ownerName,
    ...sharedWith.map((id) => names.get(id)),
    ...workers.filter((w) => w.id !== viewerId).map((w) => w.name),
  ]
  return {
    id: todo.id,
    title: todo.title,
    description: todo.description?.trim() || null,
    completed,
    completedAt: todo.completedAt ?? null,
    // The API spells it "In Progress"; the normaliser knows every spelling.
    inProgress: toApiTodoStatus(todo.status) === "inprogress" || Boolean(todo.isWorking),
    dueDate: todo.dueDate ?? null,
    dueDateStart: todo.dueDateStart ?? null,
    priority: getPriorityNumber(String(todo.priority)),
    categoryId: todo.categoryId ?? null,
    categoryName,
    categoryColor: todo.categoryColor ?? null,
    categoryIcon: todo.categoryIcon ?? null,
    mine,
    ownerId: todo.userId,
    ownerName,
    sharedWithAll: Boolean(todo.isPublic),
    sharedWith,
    workers,
    openSubtasks: todo.openSubtaskCount ?? 0,
    urgent: Boolean(todo.isVisuallyUrgent),
    hidden: Boolean(todo.hidden),
    keywords: fold([todo.description, categoryName, ...people].filter(Boolean).join(" ")),
  }
}

export interface TaskMatch {
  score: number
  /** Positions in the title to highlight. */
  indices: number[]
}

/**
 * Every token has to match: in the title as a fuzzy run, or as a plain substring
 * of the task's keywords (description, category, people). Keywords never match
 * as scattered letters — a paragraph contains almost any subsequence, and a
 * search for "bfl" must not surface every task with a long description.
 */
export function matchTask(task: PaletteTask, tokens: string[]): TaskMatch | null {
  let score = task.completed ? 15 : 0
  const indices: number[] = []
  for (const token of tokens) {
    const inTitle = fuzzyMatch(task.title, token)
    if (inTitle && inTitle.score < 20) {
      score += inTitle.score
      indices.push(...inTitle.indices)
      continue
    }
    if (task.keywords.includes(fold(token))) {
      score += 25
      continue
    }
    if (!inTitle) return null
    score += inTitle.score
    indices.push(...inTitle.indices)
  }
  return { score, indices }
}

// ─── Dates ──────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000

function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** Calendar days from today to `iso` in the reader's time zone: 0 today, -1 yesterday. */
export function daysFromToday(iso: string, now: Date): number | null {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return Math.round((startOfLocalDay(date) - startOfLocalDay(now)) / DAY_MS)
}

export type DueTone = "alert" | "warn" | "muted"

export interface DueLabel {
  label: string
  tone: DueTone
}

/** The short deadline wording a row and the preview share. Nothing for a finished task. */
export function describeDue(task: Pick<PaletteTask, "dueDate" | "completed">, now: Date): DueLabel | null {
  if (!task.dueDate || task.completed) return null
  const days = daysFromToday(task.dueDate, now)
  if (days === null) return null
  if (days < -1) return { label: `${-days} days late`, tone: "alert" }
  if (days === -1) return { label: "Yesterday", tone: "alert" }
  if (days === 0) return { label: "Today", tone: "warn" }
  if (days === 1) return { label: "Tomorrow", tone: "warn" }
  const date = new Date(task.dueDate)
  if (days < 7) return { label: date.toLocaleDateString(UI_LOCALE, { weekday: "short" }), tone: "muted" }
  return { label: date.toLocaleDateString(UI_LOCALE, { month: "short", day: "numeric" }), tone: "muted" }
}

// ─── Smart views ────────────────────────────────────────────────────────────

export type ViewId = "overdue" | "today" | "week" | "progress" | "shared" | "urgent"

export interface SmartView {
  id: ViewId
  label: string
  hint: string
  tone: "alert" | "warn" | "accent" | "ink"
  test: (task: PaletteTask, now: Date) => boolean
}

const due = (task: PaletteTask, now: Date) => (task.dueDate && !task.completed ? daysFromToday(task.dueDate, now) : null)

/** Saved questions about the open tasks, answered from what the palette already loaded. */
export const SMART_VIEWS: SmartView[] = [
  { id: "overdue", label: "Overdue", hint: "Past their deadline", tone: "alert", test: (t, now) => (due(t, now) ?? 0) < 0 },
  { id: "today", label: "Due today", hint: "Deadline is today", tone: "warn", test: (t, now) => due(t, now) === 0 },
  { id: "week", label: "This week", hint: "Due in the next seven days", tone: "ink", test: (t, now) => { const d = due(t, now); return d !== null && d >= 0 && d < 7 } },
  { id: "progress", label: "In progress", hint: "Someone is working on it", tone: "ink", test: (t) => !t.completed && (t.inProgress || t.workers.length > 0) },
  { id: "shared", label: "Shared", hint: "With friends, or from them", tone: "accent", test: (t) => !t.completed && (!t.mine || t.sharedWithAll || t.sharedWith.length > 0) },
  { id: "urgent", label: "Urgent", hint: "Urgent priority, due or late", tone: "alert", test: (t) => !t.completed && (t.urgent || t.priority >= 5) },
]

/**
 * The order "what to do next" reads in: anything late first, then by deadline,
 * then by priority; tasks without a deadline after every dated one.
 */
export function byUrgency(a: PaletteTask, b: PaletteTask): number {
  const ad = a.dueDate ? new Date(a.dueDate).getTime() : Number.POSITIVE_INFINITY
  const bd = b.dueDate ? new Date(b.dueDate).getTime() : Number.POSITIVE_INFINITY
  if (ad !== bd) return ad - bd
  return b.priority - a.priority
}
