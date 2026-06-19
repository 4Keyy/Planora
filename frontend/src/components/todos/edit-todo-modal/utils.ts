// Priority levels with English labels, colors, and descriptions
export const PRIORITY_LEVELS = [
  { key: "VeryLow", label: "Very Low", color: "#9ca3af", desc: "Can be postponed" },
  { key: "Low",     label: "Low",      color: "#10b981", desc: "Not urgent" },
  { key: "Medium",  label: "Medium",   color: "#0ea5e9", desc: "Standard" },
  { key: "High",    label: "High",     color: "#f59e0b", desc: "Important" },
  { key: "Urgent",  label: "Urgent",   color: "#ef4444", desc: "Do it now" },
] as const

const PRIORITY_TO_NUM: Record<string, number> = {
  VeryLow: 1, Low: 2, Medium: 3, High: 4, Urgent: 5, Critical: 5,
}
const NUM_TO_PRIORITY: Record<string, string> = {
  "1": "VeryLow", "2": "Low", "3": "Medium", "4": "High", "5": "Urgent",
}

export function getPriorityNumber(priority: string): number {
  return PRIORITY_TO_NUM[priority] ?? 3
}

export function getPriorityString(priority: string | number): string {
  const s = String(priority)
  if (PRIORITY_LEVELS.some((p) => p.key === s)) return s
  return NUM_TO_PRIORITY[s] ?? "Medium"
}

export function getPriorityColor(priority: string): string {
  return PRIORITY_LEVELS.find((p) => p.key === priority)?.color ?? "#9ca3af"
}

export function getPriorityLabel(priority: string): string {
  return PRIORITY_LEVELS.find((p) => p.key === priority)?.label ?? "Medium"
}

// English locale helpers
const EN_MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
export const EN_MONTHS_LONG  = ["January","February","March","April","May","June","July","August","September","October","November","December"]
export const EN_DAYS_SHORT   = ["Mo","Tu","We","Th","Fr","Sa","Su"]

// Keep Russian aliases for backward compatibility with date popover import
export const RU_MONTHS_LONG = EN_MONTHS_LONG
export const RU_DAYS_SHORT  = EN_DAYS_SHORT

export function formatDatePretty(isoDate: string): string {
  if (!isoDate) return ""
  const d = new Date(isoDate)
  const day   = d.getDate()
  const month = EN_MONTHS_SHORT[d.getMonth()]
  const year  = d.getFullYear()
  const now   = new Date()
  if (year === now.getFullYear()) return `${day} ${month}`
  return `${day} ${month} ${year}`
}

/**
 * The estimated-completion date model. A task can have no date (both null), a single target
 * date (`end` set, `start` null), or a planned interval (`start` ≤ `end`). `end` is always the
 * later bound — the deadline — so it stays the field card/overdue logic reads. ISO `YYYY-MM-DD`.
 */
export type DueRange = { start: string | null; end: string | null }

/**
 * The two-click selection state machine for the date calendar. Pure and total so it can be unit
 * tested in isolation:
 *  - empty            + click d → single date d (stored as `end`)
 *  - single (end set) + click same day → cleared
 *  - single (end set) + click other day → interval, sorted so the later day is `end`
 *  - complete interval + click d → restart as a fresh single date d
 * The later of the two picks is always the deadline (`end`); the earlier becomes `start`, exactly
 * matching the spec ("click an earlier day and it becomes the left edge, the standing date the right").
 */
export function computeNextDueRange(current: DueRange, clicked: string): DueRange {
  const { start, end } = current

  // A complete interval already exists → start over with a single anchor on the clicked day.
  if (start && end) return { start: null, end: clicked }

  // A single date exists (held in `end`).
  if (end) {
    if (clicked === end) return { start: null, end: null }            // same day → clear
    return clicked < end                                              // ISO strings sort chronologically
      ? { start: clicked, end }                                       // earlier click → it's the left edge
      : { start: end, end: clicked }                                  // later click → standing date is the left edge
  }

  // Nothing set → a single target date.
  return { start: null, end: clicked }
}

/** Whole-day span of an interval, inclusive of both ends (1 for a single day). */
export function dueRangeDays(start: string | null | undefined, end: string | null | undefined): number {
  if (!end) return 0
  if (!start || start === end) return 1
  const ms = new Date(end).getTime() - new Date(start).getTime()
  return Math.round(ms / 86_400_000) + 1
}

/** Pretty one-line label: "25 Jun" for a single date, "20 – 25 Jun" / "20 Jun – 2 Jul" for an interval. */
export function formatDueRange(start: string | null | undefined, end: string | null | undefined): string {
  if (!end) return ""
  if (!start || start === end) return formatDatePretty(end)

  const s = new Date(start)
  const e = new Date(end)
  // Collapse the shared month/year: "20 – 25 Jun" reads cleaner than "20 Jun – 25 Jun".
  const sameMonth = s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()
  if (sameMonth) return `${s.getDate()} – ${formatDatePretty(end)}`
  return `${formatDatePretty(start)} – ${formatDatePretty(end)}`
}

export function formatRelativeRu(isoDate: string): string {
  const diff = new Date(isoDate).getTime() - Date.now()
  const days = Math.round(diff / 86_400_000)
  if (days === 0)  return "today"
  if (days === 1)  return "tomorrow"
  if (days === -1) return "yesterday"
  if (days > 0)   return `in ${days}d`
  return `${Math.abs(days)}d ago`
}

export function formatDayLabel(iso: string): string {
  const d      = new Date(iso)
  const today  = new Date()
  const yest   = new Date(today); yest.setDate(today.getDate() - 1)
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  if (sameDay(d, today)) return "Today"
  if (sameDay(d, yest))  return "Yesterday"
  return `${d.getDate()} ${EN_MONTHS_SHORT[d.getMonth()]}`
}

export function formatTimeHHMM(iso: string): string {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

export function toIsoDate(iso: string): string {
  return new Date(iso).toISOString().split("T")[0]
}

// Stable hue from an ID string (for avatar gradients)
export function getHueFromId(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash) % 360
}

export const CATEGORY_COLOR_SWATCHES = [
  "#0ea5e9","#10b981","#f59e0b","#ef4444","#8b5cf6",
  "#ec4899","#06b6d4","#84cc16","#f97316","#6366f1",
  "#14b8a6","#a855f7",
]
