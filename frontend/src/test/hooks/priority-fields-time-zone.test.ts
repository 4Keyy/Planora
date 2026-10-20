import { afterEach, describe, expect, it } from "vitest"
import { priorityFields } from "@/hooks/use-priority-writer"
import { TodoPriority, TodoStatus, type Todo } from "@/types/todo"
import { restoreTimeZone, setTimeZone } from "@/test/time-zone"

// The red frame a priority change shows at once must match what the server will answer, which
// now judges "due today" on the viewer's own day (X-Time-Zone), not on the UTC day.
afterEach(restoreTimeZone)

const dueOct21: Todo = {
  id: "t", userId: "owner", title: "Report", status: TodoStatus.Pending, priority: TodoPriority.Low,
  isPublic: false, isCompleted: false, hidden: false, tags: [], createdAt: "2026-10-01T00:00:00Z",
  sharedWithUserIds: [], dueDate: "2026-10-21T00:00:00.000Z",
}

describe("priorityFields urgency", () => {
  it("frames a task due today in red after midnight in Moscow", () => {
    setTimeZone("Europe/Moscow")
    const oneThirtyOct21 = new Date("2026-10-20T22:30:00.000Z")
    expect(priorityFields(dueOct21, 2, oneThirtyOct21).isVisuallyUrgent).toBe(true)
  })

  it("does not frame tomorrow's task in the evening west of UTC", () => {
    setTimeZone("America/New_York")
    const tenPmOct20 = new Date("2026-10-21T02:00:00.000Z")
    expect(priorityFields(dueOct21, 2, tenPmOct20).isVisuallyUrgent).toBe(false)
  })

  it("keeps an Urgent task framed whatever its date", () => {
    expect(priorityFields({ ...dueOct21, dueDate: null }, 5).isVisuallyUrgent).toBe(true)
  })
})
