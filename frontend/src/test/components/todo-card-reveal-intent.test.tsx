import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TodoCard } from "@/components/todos/todo-card"
import { useAuthStore } from "@/store/auth"
import { useNotificationStore } from "@/store/notifications"
import { TodoPriority, TodoStatus, type Todo } from "@/types/todo"

const hidden: Todo = {
  id: "hidden-card",
  userId: "owner",
  title: "Adaptive layout",
  status: TodoStatus.Pending,
  priority: TodoPriority.High,
  isPublic: false,
  isCompleted: false,
  hidden: true,
  tags: [],
  createdAt: "2026-10-07T00:00:00Z",
  categoryName: "Home",
}

function renderCard(props: Partial<Parameters<typeof TodoCard>[0]> = {}) {
  const onRevealIntent = vi.fn()
  const onToggleHidden = vi.fn(async () => {})
  const view = render(
    <TodoCard
      todo={hidden}
      onComplete={vi.fn()}
      onDelete={vi.fn()}
      onEdit={vi.fn()}
      onToggleHidden={onToggleHidden}
      onRevealIntent={onRevealIntent}
      {...props}
    />,
  )
  const root = view.container.querySelector("[data-task-card]")!.parentElement as HTMLElement
  return { ...view, root, onRevealIntent, onToggleHidden }
}

describe("TodoCard — about to be opened", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useAuthStore.setState({ user: { userId: "owner", email: "owner@example.test" } } as never)
    useNotificationStore.setState({ items: [], perTask: {}, totalUnread: 0, listLoaded: false, seen: new Set() })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("says so once the pointer has rested on a hidden card, not as it sweeps past", () => {
    const { root, onRevealIntent } = renderCard()
    fireEvent.pointerEnter(root)
    act(() => vi.advanceTimersByTime(40))
    fireEvent.pointerLeave(root)
    act(() => vi.advanceTimersByTime(200))
    expect(onRevealIntent).not.toHaveBeenCalled()

    fireEvent.pointerEnter(root)
    act(() => vi.advanceTimersByTime(120))
    expect(onRevealIntent).toHaveBeenCalledTimes(1)
  })

  it("says so at once on a press or on focus", () => {
    const { root, onRevealIntent } = renderCard()
    fireEvent.pointerDown(root)
    expect(onRevealIntent).toHaveBeenCalledTimes(1)
    fireEvent.focus(screen.getByRole("button", { name: "Expand task card" }))
    expect(onRevealIntent).toHaveBeenCalledTimes(2)
  })

  it("keeps the list's own focus handling", () => {
    const onFocus = vi.fn()
    const rowProps = { ref: vi.fn(), onFocus, tabIndex: 0 as const, "data-active": undefined, "aria-current": undefined }
    const { root } = renderCard({ rowProps } as never)
    fireEvent.focus(root)
    expect(onFocus).toHaveBeenCalledTimes(1)
  })

  it("says nothing for an open card", () => {
    const { root, onRevealIntent } = renderCard({ todo: { ...hidden, hidden: false } })
    fireEvent.pointerEnter(root)
    act(() => vi.advanceTimersByTime(200))
    fireEvent.pointerDown(root)
    expect(onRevealIntent).not.toHaveBeenCalled()
  })

  it("forgets a pending rest when it unmounts", () => {
    const { root, onRevealIntent, unmount } = renderCard()
    fireEvent.pointerEnter(root)
    unmount()
    act(() => vi.advanceTimersByTime(200))
    expect(onRevealIntent).not.toHaveBeenCalled()
  })

  it("shows a page-side opening as pending and refuses another press meanwhile", () => {
    const { onToggleHidden } = renderCard({ visibilityPending: true })
    const expand = screen.getByRole("button", { name: "Expand task card" })
    expect(expand).toHaveAttribute("aria-busy", "true")
    fireEvent.click(expand)
    expect(onToggleHidden).not.toHaveBeenCalled()
  })
})
