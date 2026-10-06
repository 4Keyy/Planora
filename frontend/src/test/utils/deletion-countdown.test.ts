import { describe, it, expect } from "vitest"
import { getDeletionCountdown, COMPLETED_TASK_RETENTION_DAYS } from "@/utils/deletion-countdown"

const DAY = 24 * 60 * 60 * 1000

/** A completion timestamp whose deletion instant is `deleteAt`, under the default 30-day window. */
const completedFor = (deleteAt: Date) => new Date(deleteAt.getTime() - 30 * DAY).toISOString()

describe("getDeletionCountdown", () => {
  // Local wall-clock times, so the calendar-day assertions hold in any time zone the suite runs in.
  const now = new Date(2026, 9, 6, 10, 0)

  it("returns null when there is no completion timestamp", () => {
    expect(getDeletionCountdown(null, 30, now)).toBeNull()
    expect(getDeletionCountdown(undefined, 30, now)).toBeNull()
    expect(getDeletionCountdown("", 30, now)).toBeNull()
  })

  it("returns null for an unparseable timestamp", () => {
    expect(getDeletionCountdown("not-a-date", 30, now)).toBeNull()
  })

  it("computes days left and the deletion instant", () => {
    const completed = new Date(now.getTime() - 20 * DAY).toISOString() // completed 20 days ago
    const info = getDeletionCountdown(completed, 30, now)!

    expect(info).not.toBeNull()
    expect(info.daysLeft).toBe(10) // 30 - 20
    expect(info.deleteAt.getTime()).toBe(new Date(completed).getTime() + 30 * DAY)
  })

  it("counts calendar days: a window ending this evening is today, not tomorrow", () => {
    // Rounding the remaining eight hours up used to call this "tomorrow".
    expect(getDeletionCountdown(completedFor(new Date(2026, 9, 6, 18, 0)), 30, now)!.daysLeft).toBe(0)
  })

  it("counts calendar days: late tomorrow is tomorrow, not in two days", () => {
    // 37 hours away — two 24-hour blocks rounded up, but one calendar day.
    expect(getDeletionCountdown(completedFor(new Date(2026, 9, 7, 23, 0)), 30, now)!.daysLeft).toBe(1)
  })

  it("stays at today once the window has passed, until the hourly pass removes it", () => {
    const completed = new Date(now.getTime() - 40 * DAY).toISOString()
    expect(getDeletionCountdown(completed, 30, now)!.daysLeft).toBe(0)
  })

  it("defaults to the backend retention window", () => {
    expect(COMPLETED_TASK_RETENTION_DAYS).toBe(30)
    const completedNow = new Date(now.getTime()).toISOString()
    expect(getDeletionCountdown(completedNow, undefined, now)!.daysLeft).toBe(30)
  })
})
