import { afterEach, describe, expect, it, vi } from "vitest"
import { addDays, calendarDayOf, daysBetween, endOfWeek, formatDay, localDay } from "@/lib/calendar-date"
import { daysFromToday, describeDue } from "@/components/command-palette/search"
import { sortTasks, type SortableTask } from "@/utils/sort-tasks"
import { TodoPriority } from "@/types/todo"
import { restoreTimeZone, setTimeZone as inZone } from "@/test/time-zone"

// The editor stores a due day as its midnight UTC. These run the date logic as a viewer in
// another time zone would (`@/test/time-zone`).
afterEach(() => {
  restoreTimeZone()
  vi.useRealTimers()
})

describe("calendar days", () => {
  it("reads a stored due date as the day it names in every time zone", () => {
    for (const tz of ["UTC", "America/Los_Angeles", "America/New_York", "Europe/Moscow", "Asia/Tokyo", "Pacific/Kiritimati"]) {
      inZone(tz)
      expect(calendarDayOf("2026-10-21T00:00:00.000Z")).toBe("2026-10-21")
      expect(formatDay("2026-10-21T00:00:00.000Z", { month: "short", day: "numeric" })).toBe("Oct 21")
    }
  })

  it("takes today from the viewer's own clock", () => {
    const instant = new Date("2026-10-21T02:30:00.000Z")
    inZone("America/New_York")
    expect(localDay(instant)).toBe("2026-10-20")
    inZone("Europe/Moscow")
    expect(localDay(instant)).toBe("2026-10-21")
  })

  it("does calendar arithmetic across months, leap days and daylight saving", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01")
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29")
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29")
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01")
    inZone("America/New_York") // DST ends 2026-11-01 there
    expect(addDays("2026-10-31", 2)).toBe("2026-11-02")
    expect(daysBetween("2026-10-31", "2026-11-02")).toBe(2)
    expect(daysBetween("2026-11-02", "2026-10-31")).toBe(-2)
  })

  it("ends a Monday-to-Sunday week on its Sunday", () => {
    expect(endOfWeek("2026-10-19")).toBe("2026-10-25") // Monday
    expect(endOfWeek("2026-10-25")).toBe("2026-10-25") // Sunday
  })

  it("treats missing and invalid values as no day", () => {
    expect(calendarDayOf(null)).toBeNull()
    expect(calendarDayOf("not a date")).toBeNull()
    expect(formatDay(undefined, { day: "numeric" })).toBe("")
  })
})

describe("due dates west of UTC", () => {
  // 2026-10-21 12:00 in New York.
  const noonInNewYork = new Date("2026-10-21T16:00:00.000Z")

  it("lets the palette call tomorrow's task tomorrow, not today", () => {
    inZone("America/New_York")
    expect(daysFromToday("2026-10-22T00:00:00.000Z", noonInNewYork)).toBe(1)
    expect(describeDue({ dueDate: "2026-10-21T00:00:00.000Z", completed: false }, noonInNewYork)).toEqual({ label: "Today", tone: "warn" })
  })

  it("does not lift tomorrow's low-priority task into the urgent band", () => {
    inZone("America/New_York")
    vi.useFakeTimers()
    vi.setSystemTime(noonInNewYork)
    const tasks: SortableTask[] = [
      { id: "tomorrow-low", priority: TodoPriority.Low, dueDate: "2026-10-22T00:00:00.000Z", createdAt: "2026-10-01T00:00:00Z" },
      { id: "high-undated", priority: TodoPriority.High, createdAt: "2026-10-01T00:00:00Z" },
    ]
    expect(sortTasks(tasks).map((task) => task.id)).toEqual(["high-undated", "tomorrow-low"])
  })
})
