/**
 * A task's dates — its deadline, the start of an estimated interval, the expected date — are
 * calendar days, not moments. The editor writes a day as its midnight UTC
 * (`2026-10-21T00:00:00.000Z`) and the server keeps it that way, so the UTC date of the stored
 * instant is the day the person picked; the task editor reads it back the same way. Read in local
 * time, that instant falls on the evening before anywhere west of UTC: cards showed "Oct 20" for a
 * task due Oct 21 and flagged it overdue a day early, while the editor said Oct 21.
 *
 * Everything that asks "which day" — a label, today, overdue, the sort's date buckets — goes
 * through here. "Today" is the viewer's own local day.
 */
import { UI_LOCALE } from "@/lib/datetime"

/** A calendar day, `YYYY-MM-DD`. Compares correctly as a plain string. */
export type CalendarDay = string

const DAY_MS = 86_400_000
const pad = (n: number) => String(n).padStart(2, "0")

const parts = (day: CalendarDay): [number, number, number] => {
  const [y, m, d] = day.split("-").map(Number)
  return [y, m, d]
}

/** The calendar day a stored task date names (its UTC date); `null` when missing or invalid. */
export function calendarDayOf(value: string | Date | null | undefined): CalendarDay | null {
  if (!value) return null
  const date = typeof value === "string" ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return null
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

/** The viewer's own calendar day at `now`, in their local time zone. */
export function localDay(now: Date = new Date()): CalendarDay {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** `day` moved by `days` — calendar arithmetic, untouched by daylight-saving shifts. */
export function addDays(day: CalendarDay, days: number): CalendarDay {
  const [y, m, d] = parts(day)
  return calendarDayOf(new Date(Date.UTC(y, m - 1, d + days)))!
}

/** Whole days from `from` to `to`; negative when `to` comes first. */
export function daysBetween(from: CalendarDay, to: CalendarDay): number {
  const [fy, fm, fd] = parts(from)
  const [ty, tm, td] = parts(to)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / DAY_MS)
}

/** The last day (Sunday) of the Monday-to-Sunday week that holds `day`. */
export function endOfWeek(day: CalendarDay): CalendarDay {
  const [y, m, d] = parts(day)
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0 = Sunday
  return addDays(day, (7 - weekday) % 7)
}

/** A stored task date written as the day it names, the same in every time zone. */
export function formatDay(
  value: string | Date | null | undefined,
  options: Intl.DateTimeFormatOptions,
): string {
  if (!value) return ""
  const date = typeof value === "string" ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleDateString(UI_LOCALE, { ...options, timeZone: "UTC" })
}
