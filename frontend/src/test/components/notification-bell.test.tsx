import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { NotificationBell } from "@/components/notifications/notification-bell"
import { useNotificationStore, type AppNotification } from "@/store/notifications"

const push = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }))

const TASK = "11111111-1111-1111-1111-111111111111"

function item(over: Partial<AppNotification> = {}): AppNotification {
  return {
    id: over.id ?? crypto.randomUUID(),
    userId: "u",
    taskId: over.taskId ?? TASK,
    actorId: "a",
    type: over.type ?? "comment.added",
    title: over.title ?? "New message",
    message: over.message ?? "Hello",
    occurredOn: over.occurredOn ?? new Date().toISOString(),
    isRead: over.isRead ?? false,
  }
}

const loadList = vi.fn(async () => {})
const markAllRead = vi.fn(async () => {})
const markRead = vi.fn(async () => {})

function seed(over: Partial<ReturnType<typeof useNotificationStore.getState>> = {}) {
  useNotificationStore.setState({
    items: [],
    perTask: {},
    totalUnread: 0,
    listLoaded: false,
    seen: new Set<string>(),
    loadList,
    markAllRead,
    markRead,
    ...over,
  })
}

describe("NotificationBell", () => {
  beforeEach(() => {
    push.mockClear()
    loadList.mockClear()
    markAllRead.mockClear()
    markRead.mockClear()
    seed()
  })
  afterEach(() => vi.restoreAllMocks())

  it("shows the bell with no badge when nothing is unread", () => {
    render(<NotificationBell />)
    expect(screen.getByRole("button", { name: "Notifications" })).toBeInTheDocument()
  })

  it("shows the unread count, capping at 99+", () => {
    seed({ totalUnread: 150 })
    render(<NotificationBell />)
    expect(screen.getByRole("button", { name: /150 unread/ })).toBeInTheDocument()
    expect(screen.getByText("99+")).toBeInTheDocument()
  })

  it("opens the dropdown and lazily loads the list", async () => {
    render(<NotificationBell />)
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }))
    await waitFor(() => expect(loadList).toHaveBeenCalled())
    expect(screen.getByText("Notifications")).toBeInTheDocument()
    expect(screen.getByText(/all caught up/i)).toBeInTheDocument()
  })

  it("routes to a notification's branch and marks it read on click", async () => {
    seed({ totalUnread: 1, items: [item({ id: "n1", title: "Reply to you", taskId: TASK })] })
    render(<NotificationBell />)
    fireEvent.click(screen.getByRole("button", { name: /1 unread/ }))
    fireEvent.click(await screen.findByText("Reply to you"))
    expect(markRead).toHaveBeenCalledWith(["n1"])
    expect(push).toHaveBeenCalledWith(`/branch/${TASK}`)
  })

  it("marks everything read from the header", async () => {
    seed({ totalUnread: 2, items: [item(), item()] })
    render(<NotificationBell />)
    fireEvent.click(screen.getByRole("button", { name: /2 unread/ }))
    fireEvent.click(await screen.findByText("Mark all read"))
    expect(markAllRead).toHaveBeenCalled()
  })

  it("closes on Escape", async () => {
    render(<NotificationBell />)
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }))
    expect(await screen.findByText("Notifications")).toBeInTheDocument()
    fireEvent.keyDown(document, { key: "Escape" })
    await waitFor(() => expect(screen.queryByText(/all caught up/i)).not.toBeInTheDocument())
  })
})
