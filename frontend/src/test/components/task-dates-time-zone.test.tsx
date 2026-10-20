import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TodoCard } from "@/components/todos/todo-card"
import { DateCalendar } from "@/components/todos/edit-todo-modal/popovers/date"
import { useAuthStore } from "@/store/auth"
import { useNotificationStore } from "@/store/notifications"
import { TodoPriority, TodoStatus, type Todo } from "@/types/todo"

// A due day is stored as its midnight UTC; these render as a viewer elsewhere would.
const originalTz = process.env.TZ

const task: Todo = {
  id: "due-day", userId: "owner", title: "File the report",
  status: TodoStatus.Pending, priority: TodoPriority.Medium, isPublic: false,
  isCompleted: false, hidden: false, tags: [], createdAt: "2026-10-01T00:00:00Z",
  sharedWithUserIds: [], dueDate: "2026-10-21T00:00:00.000Z",
}

beforeEach(() => {
  useAuthStore.setState({ user: { userId: "owner", email: "owner@example.test" } } as never)
  useNotificationStore.setState({ items: [], perTask: {}, totalUnread: 0, listLoaded: false, seen: new Set() })
})

afterEach(() => {
  process.env.TZ = originalTz
  vi.useRealTimers()
})

describe("a task card west of UTC", () => {
  it("shows the day the task is due and does not call it overdue on that day", () => {
    process.env.TZ = "America/New_York"
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-10-21T16:00:00.000Z")) // noon, Oct 21, in New York

    render(<TodoCard todo={task} onComplete={vi.fn()} onDelete={vi.fn()} onEdit={vi.fn()} />)

    expect(screen.getByText("Oct 21")).toBeInTheDocument()
    expect(screen.queryByText("Oct 20")).not.toBeInTheDocument()
    expect(screen.queryByText("Overdue")).not.toBeInTheDocument()
  })

  it("calls it overdue from the next day on", () => {
    process.env.TZ = "America/New_York"
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-10-22T16:00:00.000Z"))

    render(<TodoCard todo={task} onComplete={vi.fn()} onDelete={vi.fn()} onEdit={vi.fn()} />)

    expect(screen.getByText("Overdue")).toBeInTheDocument()
  })
})

describe("the date picker's Today east of UTC, after midnight", () => {
  it("picks the viewer's day, not yesterday's UTC date", () => {
    process.env.TZ = "Europe/Moscow"
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-10-20T22:30:00.000Z")) // 01:30, Oct 21, in Moscow
    const onChange = vi.fn()

    render(<DateCalendar start="" end="" onChange={onChange} />)
    fireEvent.click(screen.getByRole("button", { name: /^Today/ }))
    fireEvent.click(screen.getByRole("button", { name: /^Tomorrow/ }))

    expect(onChange).toHaveBeenNthCalledWith(1, null, "2026-10-21")
    expect(onChange).toHaveBeenNthCalledWith(2, null, "2026-10-22")
  })
})
