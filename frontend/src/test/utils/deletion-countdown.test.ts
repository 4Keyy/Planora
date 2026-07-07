import { describe, it, expect } from "vitest"
import { getDeletionCountdown, COMPLETED_TASK_RETENTION_DAYS } from "@/utils/deletion-countdown"

const DAY = 24 * 60 * 60 * 1000

describe("getDeletionCountdown", () => {
  const now = new Date("2026-07-07T03:00:00.000Z")

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

  it("clamps days left to 0 once the window has passed", () => {
    const completed = new Date(now.getTime() - 40 * DAY).toISOString()
    expect(getDeletionCountdown(completed, 30, now)!.daysLeft).toBe(0)
  })

  it("defaults to the backend retention window", () => {
    expect(COMPLETED_TASK_RETENTION_DAYS).toBe(30)
    const completedNow = new Date(now.getTime()).toISOString()
    expect(getDeletionCountdown(completedNow, undefined, now)!.daysLeft).toBe(30)
  })
})
