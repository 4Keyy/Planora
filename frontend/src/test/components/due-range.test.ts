import { describe, expect, it } from "vitest"
import {
  computeNextDueRange,
  dueRangeDays,
  formatDueRange,
  type DueRange,
} from "@/components/todos/edit-todo-modal/utils"

const empty: DueRange = { start: null, end: null }

describe("computeNextDueRange — two-click selection", () => {
  it("sets a single target date from empty", () => {
    expect(computeNextDueRange(empty, "2026-06-20")).toEqual({ start: null, end: "2026-06-20" })
  })

  it("clears when the same single date is clicked again", () => {
    const single: DueRange = { start: null, end: "2026-06-20" }
    expect(computeNextDueRange(single, "2026-06-20")).toEqual({ start: null, end: null })
  })

  it("makes an interval when an earlier day is clicked — the earlier becomes the left edge", () => {
    const single: DueRange = { start: null, end: "2026-06-20" }
    // Click a day BEFORE the standing date: it becomes the start, the standing date stays the deadline.
    expect(computeNextDueRange(single, "2026-06-15")).toEqual({ start: "2026-06-15", end: "2026-06-20" })
  })

  it("makes an interval when a later day is clicked — the standing date becomes the left edge", () => {
    const single: DueRange = { start: null, end: "2026-06-20" }
    // Click a day AFTER the standing date: the standing date becomes the start, the new day the deadline.
    expect(computeNextDueRange(single, "2026-06-25")).toEqual({ start: "2026-06-20", end: "2026-06-25" })
  })

  it("restarts as a fresh single date once a full interval exists", () => {
    const range: DueRange = { start: "2026-06-15", end: "2026-06-20" }
    expect(computeNextDueRange(range, "2026-07-01")).toEqual({ start: null, end: "2026-07-01" })
  })
})

describe("dueRangeDays", () => {
  it("is 0 with no end", () => expect(dueRangeDays(null, null)).toBe(0))
  it("is 1 for a single date", () => expect(dueRangeDays(null, "2026-06-20")).toBe(1))
  it("is inclusive of both bounds", () => expect(dueRangeDays("2026-06-20", "2026-06-25")).toBe(6))
})

describe("formatDueRange", () => {
  it("returns an empty string with no end", () => expect(formatDueRange(null, null)).toBe(""))
  it("formats a single date", () => expect(formatDueRange(null, "2026-06-20")).toBe("20 Jun"))
  it("collapses a same-month interval", () => expect(formatDueRange("2026-06-20", "2026-06-25")).toBe("20 – 25 Jun"))
  it("keeps both months for a cross-month interval", () =>
    expect(formatDueRange("2026-06-28", "2026-07-03")).toBe("28 Jun – 3 Jul"))
})
