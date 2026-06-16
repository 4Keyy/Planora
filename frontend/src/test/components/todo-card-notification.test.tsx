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
    useNotificationStore.setState({ perTask: { "todo-1": { count: 2, latestType: "task.review" } }, totalUnread: 2 })
    const markTaskRead = vi.spyOn(useNotificationStore.getState(), "markTaskRead").mockResolvedValue()
    const onEdit = vi.fn()

    render(<TodoCard todo={todo} onComplete={vi.fn()} onDelete={vi.fn()} onEdit={onEdit} />)

    expect(screen.getByRole("status")).toBeInTheDocument()

    fireEvent.click(screen.getByText("Notify me"))
    expect(markTaskRead).toHaveBeenCalledWith("todo-1")
    expect(onEdit).toHaveBeenCalled()
  })

  it("renders no mark when nothing is unread for the task", () => {
    render(<TodoCard todo={todo} onComplete={vi.fn()} onDelete={vi.fn()} onEdit={vi.fn()} />)
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
  })
})
