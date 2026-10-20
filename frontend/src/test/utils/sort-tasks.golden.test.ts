import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TodoPriority } from "@/types/todo"
import { sortTasks } from "@/utils/sort-tasks"
import { goldenNow, goldenTasks } from "@/test/fixtures/golden-tasks"

const EXPECTED_IDS = [
  "u-working-overdue", "u-working-today",
  "u-overdue-urgent-priority", "u-overdue-high", "u-overdue-medium",
  "u-today-urgent", "u-today-low", "u-urgent-tomorrow", "u-flag-true-future", "u-no-due",
  "u-hidden-working", "u-hidden-flag",
  "p-working", "p-urgent-muted", "p-high-overdue-muted", "p-high-tomorrow", "p-high-week", "p-high-no-due",
  "p-hidden-working", "p-hidden",
  "s-working", "s-overdue-muted", "s-today-muted", "s-tomorrow-list", "s-week-flag", "s-future-public",
  "s-undated-list", "s-invalid-shared", "s-hidden-working", "s-hidden",
  "r-working", "r-overdue-muted", "r-today-muted", "r-tomorrow", "r-week", "r-future", "r-authoritative-private",
  "r-undated-new", "r-undated", "r-invalid-equal-a", "r-undated-equal-b",
  "r-hidden-working", "r-held-opened", "r-hidden",
  "c-new", "c-status-done", "c-no-completed", "c-invalid-completed",
]

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(goldenNow())
})

afterEach(() => vi.useRealTimers())

describe("golden task order", () => {
  it("preserves the documented bands, visibility groups and smart order", () => {
    const tasks = goldenTasks()
    const inputIds = tasks.map(task => task.id)

    expect(sortTasks(tasks).map(task => task.id)).toEqual(EXPECTED_IDS)
    expect(tasks.map(task => task.id)).toEqual(inputIds)
  })

  it("releases a held place when a sorting key changes", () => {
    const tasks = goldenTasks().filter(task => ["r-held-opened", "r-tomorrow", "r-hidden"].includes(task.id))
    const opened = tasks.find(task => task.id === "r-held-opened")!

    expect(sortTasks(tasks).map(task => task.id)).toEqual(["r-tomorrow", "r-held-opened", "r-hidden"])
    opened.priority = TodoPriority.High
    expect(sortTasks(tasks).map(task => task.id)).toEqual(["r-held-opened", "r-tomorrow", "r-hidden"])
  })
})
