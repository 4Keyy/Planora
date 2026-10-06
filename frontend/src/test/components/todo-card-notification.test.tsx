import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { TodoCard } from "@/components/todos/todo-card"
import { useAuthStore } from "@/store/auth"
import { useNotificationStore } from "@/store/notifications"
import { TodoStatus, TodoPriority, type Todo } from "@/types/todo"

const todo = {
  id: "todo-1",
  userId: "owner-1",
  title: "Notify me",
  description: null,
  status: TodoStatus.Pending,
  priority: TodoPriority.Medium,
  isPublic: true,
  isCompleted: false,
  hidden: false,
  tags: [],
  createdAt: "2026-05-01T00:00:00.000Z",
  sharedWithUserIds: ["friend-1"],
} as unknown as Todo

describe("TodoCard notification mark", () => {
  beforeEach(() => {
    useAuthStore.setState({ user: { userId: "owner-1", email: "o@e.com" } } as never)
    useNotificationStore.setState({ items: [], perTask: {}, totalUnread: 0, listLoaded: false, seen: new Set() })
  })
  afterEach(() => vi.restoreAllMocks())

  it("shows the unread mark and clears it when the card opens", () => {
    useNotificationStore.setState({ perTask: { "todo-1": { count: 2, latestType: "task.review", groups: [{ type: "task.review", count: 2, latestOccurredOn: "2026-05-01T00:00:00Z" }] } }, totalUnread: 2 })
    const markTaskRead = vi.spyOn(useNotificationStore.getState(), "markTaskRead").mockResolvedValue()
    const onEdit = vi.fn()

    render(<TodoCard todo={todo} onComplete={vi.fn()} onDelete={vi.fn()} onEdit={onEdit} />)

    expect(screen.getByRole("status")).toBeInTheDocument()

    fireEvent.click(screen.getByText("Notify me"))
    expect(markTaskRead).toHaveBeenCalledWith("todo-1")
    expect(onEdit).toHaveBeenCalled()
  })

  it("renders the multi-type badge cluster when several event types are unread", () => {
    useNotificationStore.setState({
      perTask: {
        "todo-1": {
          count: 3,
          latestType: "task.review",
          groups: [
            { type: "task.review", count: 1, latestOccurredOn: "2026-05-01T12:05:00Z" },
            { type: "comment.added", count: 2, latestOccurredOn: "2026-05-01T12:01:00Z" },
          ],
        },
      },
      totalUnread: 3,
    })

    render(<TodoCard todo={todo} onComplete={vi.fn()} onDelete={vi.fn()} onEdit={vi.fn()} />)

    // The cluster announces the spread of types it represents.
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", expect.stringContaining("2 types"))
  })

  it("renders no mark when nothing is unread for the task", () => {
    render(<TodoCard todo={todo} onComplete={vi.fn()} onDelete={vi.fn()} onEdit={vi.fn()} />)
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
  })

  it("renders an estimated-completion interval as a start – deadline range", () => {
    const rangeTodo = {
      ...todo,
      id: "todo-range",
      dueDateStart: "2026-12-20T00:00:00.000Z",
      dueDate: "2026-12-25T00:00:00.000Z",
    } as unknown as Todo
    render(<TodoCard todo={rangeTodo} onComplete={vi.fn()} onDelete={vi.fn()} onEdit={vi.fn()} />)
    // The en dash is unique to the range branch — a single date renders without it. It is
    // one line of text, so the range can never wrap between its two dates.
    expect(screen.getByText(/^\S+ \d+ – \S+ \d+$/)).toBeInTheDocument()
  })

  it("renders a single due date without a range", () => {
    const singleTodo = {
      ...todo,
      id: "todo-single",
      dueDate: "2026-12-25T00:00:00.000Z",
    } as unknown as Todo
    render(<TodoCard todo={singleTodo} onComplete={vi.fn()} onDelete={vi.fn()} onEdit={vi.fn()} />)
    expect(screen.queryByText(/ – /)).not.toBeInTheDocument()
  })
})

describe("TodoCard — the frame says who a task concerns", () => {
  /**
   * Two colours, one meaning each: `alert` for "needs answering today", `accent` for
   * "other people can see this", and the plain line for a private task. Work in progress
   * is the check and the workers chip, never the frame.
   */
  const withBorder = (overrides: Partial<Todo>) => {
    const { container } = render(
      <TodoCard
        todo={{ ...todo, ...overrides } as Todo}
        onComplete={vi.fn()}
        onDelete={vi.fn()}
        onEdit={vi.fn()}
      />,
    )
    const card = container.querySelector("[data-task-card]") as HTMLElement
    return card
  }

  const PRIVATE = { isPublic: false, sharedWithUserIds: [], hasSharedAudience: false }

  it("marks a card that needs answering today in alert", () => {
    expect(withBorder({ isVisuallyUrgent: true }).className).toContain("border-alert")
  })

  it("frames a shared task in the accent blue", () => {
    const cls = withBorder({ isVisuallyUrgent: false, isPublic: true, hasSharedAudience: true }).className
    expect(cls).toContain("border-accent")
    expect(cls).not.toContain("border-line")
  })

  it("frames a task shared with named friends the same way as one shared with all", () => {
    const cls = withBorder({ isVisuallyUrgent: false, isPublic: false, hasSharedAudience: true }).className
    expect(cls).toContain("border-accent")
  })

  it("leaves a private task on the plain line, in progress or not", () => {
    expect(withBorder({ ...PRIVATE, isVisuallyUrgent: false }).className).toContain("border-line")
    const working = withBorder({ ...PRIVATE, isVisuallyUrgent: false, status: "In Progress" }).className
    expect(working).toContain("border-line")
    expect(working).not.toContain("border-accent")
  })

  it("keeps alert when a shared task is also due today", () => {
    // Precedence, not a blend: the thing that asks for action wins.
    const cls = withBorder({ isVisuallyUrgent: true, hasSharedAudience: true }).className
    expect(cls).toContain("border-alert")
    expect(cls).not.toContain("border-accent")
  })

  it("glows in the category's colour on hover, and plain grey without one", () => {
    const tinted = withBorder({ isVisuallyUrgent: false, categoryColor: "#10b981" })
    expect(tinted.style.getPropertyValue("--card-glow")).toContain("#10b981")
    expect(tinted.className).toContain("group-hover/card:shadow-[0_8px_32px_-4px_var(--card-glow)")
    const plain = withBorder({ ...PRIVATE, isVisuallyUrgent: false, categoryColor: null })
    expect(plain.style.getPropertyValue("--card-glow")).toBe("")
    expect(plain.className).toContain("group-hover/card:shadow-lg")
  })
})
