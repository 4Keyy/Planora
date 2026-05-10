import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getTaskWeight, sortTasks, type SortableTask } from "@/utils/sort-tasks"
import { TodoPriority, TodoStatus } from "@/types/todo"

const task = (id: string, overrides: Partial<SortableTask> = {}): SortableTask => ({
  id,
  createdAt: "2026-05-01T08:00:00.000Z",
  priority: TodoPriority.Medium,
  status: TodoStatus.Pending,
  isCompleted: false,
  ...overrides,
})

describe("sortTasks", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-05-01T12:00:00.000Z"))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("sorts active tasks by due-date bucket before completed tasks", () => {
    const sorted = sortTasks([
      task("no-date", { dueDate: null }),
      task("completed", {
        isCompleted: true,
        completedAt: "2026-05-01T10:00:00.000Z",
        dueDate: "2026-04-30T00:00:00.000Z",
      }),
      task("tomorrow", { dueDate: "2026-05-02T00:00:00.000Z" }),
      task("future", { dueDate: "2026-05-11T00:00:00.000Z" }),
      task("today", { dueDate: "2026-05-01T00:00:00.000Z" }),
      task("overdue", { dueDate: "2026-04-29T00:00:00.000Z" }),
      task("this-week", { dueDate: "2026-05-03T00:00:00.000Z" }),
    ])

    expect(sorted.map((item) => item.id)).toEqual([
      "overdue",
      "today",
      "tomorrow",
      "this-week",
      "future",
      "no-date",
      "completed",
    ])
  })

  it("uses priority as a tie-breaker for same-day tasks", () => {
    const sorted = sortTasks([
      task("none", { dueDate: "2026-05-01T00:00:00.000Z", priority: null }),
      task("very-low", { dueDate: "2026-05-01T00:00:00.000Z", priority: TodoPriority.VeryLow }),
      task("low", { dueDate: "2026-05-01T00:00:00.000Z", priority: TodoPriority.Low }),
      task("urgent", { dueDate: "2026-05-01T00:00:00.000Z", priority: TodoPriority.Urgent }),
      task("high", { dueDate: "2026-05-01T00:00:00.000Z", priority: "4" }),
    ])

    expect(sorted.map((item) => item.id)).toEqual(["urgent", "high", "low", "very-low", "none"])
  })

  it("preserves input order when every sort key is identical", () => {
    const sorted = sortTasks([
      task("a", { dueDate: null }),
      task("b", { dueDate: null }),
    ])

    expect(sorted.map((item) => item.id)).toEqual(["a", "b"])
  })

  it("does not mutate the original array", () => {
    const original = [
      task("later", { dueDate: "2026-05-03T00:00:00.000Z" }),
      task("now", { dueDate: "2026-05-01T00:00:00.000Z" }),
    ]

    expect(sortTasks(original).map((item) => item.id)).toEqual(["now", "later"])
    expect(original.map((item) => item.id)).toEqual(["later", "now"])
  })
})

describe("getTaskWeight", () => {
  it("uses a compact weight for hidden tasks", () => {
    expect(getTaskWeight(task("hidden", { hidden: true }))).toBe(80)
  })

  it("adds weight for long titles, descriptions, dates, and in-progress status", () => {
    expect(
      getTaskWeight(
        task("large", {
          title: "A very long task title that wraps",
          description: "x".repeat(90),
          dueDate: "2026-05-01T00:00:00.000Z",
          status: TodoStatus.InProgress,
        }),
      ),
    ).toBe(332)
  })
})
