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

  it("renders an estimated-completion interval as a start → deadline range", () => {
    const rangeTodo = {
      ...todo,
      id: "todo-range",
      dueDateStart: "2026-12-20T00:00:00.000Z",
      dueDate: "2026-12-25T00:00:00.000Z",
    } as unknown as Todo
    render(<TodoCard todo={rangeTodo} onComplete={vi.fn()} onDelete={vi.fn()} onEdit={vi.fn()} />)
    // The arrow separator is unique to the range branch — a single date renders without it.
    expect(screen.getByText("→")).toBeInTheDocument()
  })

  it("renders a single due date without a range arrow", () => {
    const singleTodo = {
      ...todo,
      id: "todo-single",
      dueDate: "2026-12-25T00:00:00.000Z",
    } as unknown as Todo
    render(<TodoCard todo={singleTodo} onComplete={vi.fn()} onDelete={vi.fn()} onEdit={vi.fn()} />)
    expect(screen.queryByText("→")).not.toBeInTheDocument()
  })
})

describe("TodoCard — the border says one thing", () => {
  /**
   * Three states used to compete for the card's border, and `accent` was returned
   * for two of them. The design system spends `accent` on links, the active tab and
   * SELECTION — so an accent border on an unselected card is the one thing on screen
   * most likely to be misread while a multi-selection is up.
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
    const card = container.querySelector(".border-2") as HTMLElement
    return card.className
  }

  it("marks a card that needs answering today, and nothing else", () => {
    expect(withBorder({ isVisuallyUrgent: true })).toContain("border-alert")
  })

  it("leaves an in-progress card on the plain line", () => {
    // In progress is already said twice a few pixels away — the accent chip and the
    // accent ring on the completion control. A third copy costs the accent its meaning.
    const cls = withBorder({ isVisuallyUrgent: false, status: "In Progress", isWorking: true })
    expect(cls).toContain("border-line")
    expect(cls).not.toContain("border-accent")
  })

  it("leaves a merely shared card on the plain line", () => {
    // Sharing is a property, not a state, and the redaction arc says how wide the
    // audience is — which a border colour cannot.
    const cls = withBorder({ isVisuallyUrgent: false, isPublic: true, hasSharedAudience: true })
    expect(cls).toContain("border-line")
    expect(cls).not.toContain("border-accent")
  })

  it("keeps the alert border when a task is both overdue and in progress", () => {
    // Precedence, not a blend. The previous version painted three sides an indigo
    // that exists in no token and no other file in the product.
    const cls = withBorder({ isVisuallyUrgent: true, status: "In Progress", isWorking: true })
    expect(cls).toContain("border-alert")
    expect(cls).not.toContain("border-accent")
  })
})
