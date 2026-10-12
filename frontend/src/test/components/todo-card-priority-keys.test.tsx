import { act, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TodoCard } from "@/components/todos/todo-card"
import { resetPriorityKeysForTests } from "@/lib/priority-keys"
import { useAuthStore } from "@/store/auth"
import { useNotificationStore } from "@/store/notifications"
import { TodoPriority, TodoStatus, type Todo } from "@/types/todo"

const base: Todo = {
  id: "keys-1",
  userId: "owner",
  title: "Renew the household insurance policy",
  status: TodoStatus.Pending,
  priority: TodoPriority.Medium,
  isPublic: false,
  isCompleted: false,
  hidden: false,
  tags: [],
  createdAt: "2026-10-07T00:00:00Z",
}

/** Renders a card and rests the pointer on it — `elementFromPoint` answers with its surface. */
function pointAt(todo: Partial<Todo> = {}, props: { variant?: "default" | "completed"; withHandler?: boolean } = {}) {
  const onPriority = vi.fn()
  const view = render(
    <TodoCard
      todo={{ ...base, ...todo }}
      variant={props.variant}
      onComplete={vi.fn()}
      onDelete={vi.fn()}
      onEdit={vi.fn()}
      onToggleHidden={vi.fn(async () => {})}
      onPriority={props.withHandler === false ? undefined : onPriority}
    />,
  )
  const surface = view.container.querySelector("[data-task-card]")!
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => surface })
  const move = new MouseEvent("pointermove", { clientX: 40, clientY: 40 })
  Object.defineProperty(move, "pointerType", { value: "mouse" })
  act(() => {
    window.dispatchEvent(move)
  })
  const press = (key: string) => {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })
    act(() => {
      document.body.dispatchEvent(event)
    })
    return event
  }
  return { ...view, onPriority, press }
}

beforeEach(() => {
  resetPriorityKeysForTests()
  useAuthStore.setState({ user: { userId: "owner", email: "owner@example.test" } } as never)
  useNotificationStore.setState({ items: [], perTask: {}, totalUnread: 0, listLoaded: false, seen: new Set() })
})

afterEach(() => {
  resetPriorityKeysForTests()
})

describe("TodoCard and the number keys under the pointer", () => {
  it("sets the priority of the owner's open card", () => {
    const { press, onPriority } = pointAt()
    const event = press("4")
    expect(onPriority).toHaveBeenCalledWith(4)
    expect(event.defaultPrevented).toBe(true)
  })

  it("passes over a friend's card: only the owner may change a priority", () => {
    const { press, onPriority } = pointAt({ userId: "friend", sharedWithUserIds: ["owner"], hasSharedAudience: true })
    expect(press("4").defaultPrevented).toBe(false)
    expect(onPriority).not.toHaveBeenCalled()
  })

  it("passes over a hidden card, which holds only the server's redacted copy", () => {
    const { press, onPriority } = pointAt({ hidden: true })
    press("4")
    expect(onPriority).not.toHaveBeenCalled()
  })

  it("passes over a finished card, which shows no priority", () => {
    const { press, onPriority } = pointAt({ status: TodoStatus.Done, isCompleted: true }, { variant: "completed" })
    press("4")
    expect(onPriority).not.toHaveBeenCalled()
  })

  it("passes over a card nobody gave a way to save one", () => {
    const { press } = pointAt({}, { withHandler: false })
    expect(press("4").defaultPrevented).toBe(false)
  })

  it("does nothing for a number above five", () => {
    const { press, onPriority } = pointAt()
    press("7")
    expect(onPriority).not.toHaveBeenCalled()
  })

  it("answers a key for the level it already has: the filled segments tick", () => {
    const { press, onPriority, container } = pointAt({ priority: TodoPriority.Medium })
    const meter = container.querySelector("[role='img'][aria-label^='Priority']")!
    expect(meter.querySelectorAll("[class*='animate-meter']")).toHaveLength(0)

    press("3")

    expect(onPriority).toHaveBeenCalledWith(3)
    expect(meter.querySelectorAll("[class*='animate-meter']")).toHaveLength(3)
  })
})
