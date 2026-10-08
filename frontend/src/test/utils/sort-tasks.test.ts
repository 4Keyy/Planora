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

  it("places an in-progress task with a far-future due date at the front of the working group", () => {
    const sorted = sortTasks([
      task("regular", { dueDate: "2026-05-10T00:00:00.000Z" }),
      task("working-far", {
        status: TodoStatus.InProgress,
        dueDate: "2026-05-10T00:00:00.000Z",
      }),
    ])

    expect(sorted.map((t) => t.id)).toEqual(["working-far", "regular"])
  })

  it("places an in-progress task due today before non-in-progress tasks", () => {
    const sorted = sortTasks([
      task("regular-today", { dueDate: "2026-05-01T00:00:00.000Z" }),
      task("working-today", {
        status: TodoStatus.InProgress,
        dueDate: "2026-05-01T00:00:00.000Z",
      }),
    ])

    expect(sorted.map((t) => t.id)).toEqual(["working-today", "regular-today"])
  })

  it("sorts completed tasks with an invalid completedAt date without throwing", () => {
    const sorted = sortTasks([
      task("valid-completed", {
        isCompleted: true,
        completedAt: "2026-05-01T10:00:00.000Z",
      }),
      task("bad-date-completed", {
        isCompleted: true,
        completedAt: "not-a-date",
      }),
    ])

    expect(sorted.map((t) => t.id)).toHaveLength(2)
  })

  it("treats a task with status 'completed' (string) the same as isCompleted", () => {
    const sorted = sortTasks([
      task("active", { dueDate: "2026-05-01T00:00:00.000Z" }),
      task("string-completed", { status: "completed" }),
    ])

    expect(sorted.map((t) => t.id)).toEqual(["active", "string-completed"])
  })

  it("treats a task with status 'done' (string) as completed", () => {
    const sorted = sortTasks([
      task("active", { dueDate: "2026-05-01T00:00:00.000Z" }),
      task("string-done", { status: "done", isCompleted: false }),
    ])

    expect(sorted.map((t) => t.id)).toEqual(["active", "string-done"])
  })

  it("handles a task with null status in taskIsWorkingOn without throwing", () => {
    const sorted = sortTasks([
      task("null-status", { status: null }),
      task("active", { dueDate: "2026-05-01T00:00:00.000Z" }),
    ])

    expect(sorted.map((t) => t.id)).toHaveLength(2)
  })

  it("treats a task with isWorking true as in-progress and sorts it first", () => {
    const sorted = sortTasks([
      task("regular", { dueDate: "2026-05-01T00:00:00.000Z" }),
      task("is-working", { isWorking: true, dueDate: "2026-05-01T00:00:00.000Z" }),
    ])

    expect(sorted.map((t) => t.id)).toEqual(["is-working", "regular"])
  })

  it("handles a task with an invalid dueDate string without throwing", () => {
    const sorted = sortTasks([
      task("valid-due", { dueDate: "2026-05-01T00:00:00.000Z" }),
      task("bad-due", { dueDate: "not-a-date" }),
    ])

    expect(sorted.map((t) => t.id)).toHaveLength(2)
  })

  it("handles a task with an invalid createdAt string without throwing", () => {
    const sorted = sortTasks([
      task("normal", {}),
      task("bad-created", { createdAt: "not-a-date" }),
    ])

    expect(sorted.map((t) => t.id)).toHaveLength(2)
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
  // The card's own geometry: a 42px frame round the body; a title line is 27.5px, the chip
  // row a 12px gap plus 24px. No floor: a sparse card is as short as its content.
  it("weighs a hidden task as its one collapsed row", () => {
    expect(getTaskWeight(task("hidden", { hidden: true }))).toBe(46)
  })

  it("weighs a sparse task as a title and a chip row, with no height floor", () => {
    expect(getTaskWeight(task("plain"))).toBe(42 + 27.5 + 36)
    expect(getTaskWeight(task("short-title", { title: "Short" }))).toBe(42 + 27.5 + 36)
  })

  it("adds title lines (up to three), two description lines, the date and the expected strip", () => {
    expect(
      getTaskWeight(
        task("large", {
          title: "A very long task title that wraps",
          description: "x".repeat(90),
          dueDate: "2026-05-01T00:00:00.000Z",
          expectedDate: "2026-05-02T00:00:00.000Z",
        }),
      ),
    ).toBe(42 + 2 * 27.5 + 36 + (12 + 2 * 20) + (12 + 16) + 57)
    expect(getTaskWeight(task("very-long", { title: "x".repeat(200) }))).toBe(42 + 3 * 27.5 + 36)
  })

  it("does not weigh a status the card does not draw", () => {
    expect(getTaskWeight(task("inprog-only", { status: TodoStatus.InProgress }))).toBe(42 + 27.5 + 36)
  })

  it("weighs a completed task as its title alone, and never hides it as a collapsed row", () => {
    expect(getTaskWeight(task("done", { isCompleted: true, hidden: true, title: "Short" }))).toBe(42 + 32)
  })
})
