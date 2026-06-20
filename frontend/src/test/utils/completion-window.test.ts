import { describe, it, expect } from "vitest"
import { buildCompletionWindow } from "@/utils/completion-window"

describe("buildCompletionWindow", () => {
  it("returns an empty window when nothing is selected", () => {
    expect(buildCompletionWindow("", "")).toEqual({})
  })

  it("treats a single day (held in `end`) as that whole local day", () => {
    const { completedFrom, completedTo } = buildCompletionWindow("", "2026-06-20")
    expect(completedFrom).toBeDefined()
    expect(completedTo).toBeDefined()

    // Assert on the LOCAL day edges (not the exact ISO string) so the test is
    // robust across whatever timezone the runner happens to use.
    const from = new Date(completedFrom!)
    const to = new Date(completedTo!)
    expect([from.getFullYear(), from.getMonth(), from.getDate()]).toEqual([2026, 5, 20])
    expect([from.getHours(), from.getMinutes(), from.getSeconds()]).toEqual([0, 0, 0])
    expect([to.getFullYear(), to.getMonth(), to.getDate()]).toEqual([2026, 5, 20])
    expect([to.getHours(), to.getMinutes(), to.getSeconds()]).toEqual([23, 59, 59])
    expect(from.getTime()).toBeLessThan(to.getTime())
  })

  it("spans an interval from the start day's open to the end day's close", () => {
    const { completedFrom, completedTo } = buildCompletionWindow("2026-06-18", "2026-06-20")
    const from = new Date(completedFrom!)
    const to = new Date(completedTo!)
    expect([from.getFullYear(), from.getMonth(), from.getDate()]).toEqual([2026, 5, 18])
    expect([from.getHours(), from.getMinutes()]).toEqual([0, 0])
    expect([to.getFullYear(), to.getMonth(), to.getDate()]).toEqual([2026, 5, 20])
    expect([to.getHours(), to.getMinutes()]).toEqual([23, 59])
    expect(from.getTime()).toBeLessThan(to.getTime())
  })

  it("serializes both bounds as UTC instants (ISO 8601, trailing Z)", () => {
    const { completedFrom, completedTo } = buildCompletionWindow("2026-01-01", "2026-01-02")
    expect(completedFrom).toMatch(/Z$/)
    expect(completedTo).toMatch(/Z$/)
  })
})
