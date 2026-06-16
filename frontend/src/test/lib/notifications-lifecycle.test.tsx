import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { renderHook } from "@testing-library/react"

const { onMock, notifySystem } = vi.hoisted(() => ({
  onMock: vi.fn((_event: string, _cb: (p: unknown) => void): (() => void) => () => {}),
  notifySystem: vi.fn(),
}))
vi.mock("@/lib/realtime/client", () => ({
  realtime: { on: onMock, start: vi.fn(), stop: vi.fn() },
}))
vi.mock("@/lib/notifications/web-notifications", () => ({ notifySystem }))

import { useNotificationsLifecycle } from "@/lib/realtime/hooks"
import { useAuthStore } from "@/store/auth"
import { useNotificationStore } from "@/store/notifications"

function receiveHandler(): (p: unknown) => void {
  const call = onMock.mock.calls.find((c) => c[0] === "ReceiveNotification") as
    | [string, (p: unknown) => void]
    | undefined
  if (!call) throw new Error("ReceiveNotification was not subscribed")
  return call[1]
}

describe("useNotificationsLifecycle", () => {
  beforeEach(() => {
    onMock.mockClear()
    notifySystem.mockClear()
    useNotificationStore.setState({ seen: new Set<string>() })
    vi.spyOn(useNotificationStore.getState(), "hydrate").mockResolvedValue()
    vi.spyOn(useNotificationStore.getState(), "ingest").mockImplementation(() => {})
    vi.spyOn(useNotificationStore.getState(), "reset").mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it("hydrates and subscribes while authenticated", () => {
    useAuthStore.setState({ isAuthenticated: true })
    renderHook(() => useNotificationsLifecycle())
    expect(useNotificationStore.getState().hydrate).toHaveBeenCalled()
    expect(onMock).toHaveBeenCalledWith("ReceiveNotification", expect.any(Function))
  })

  it("ingests a push and raises an OS notification for system kinds", () => {
    useAuthStore.setState({ isAuthenticated: true })
    renderHook(() => useNotificationsLifecycle())
    receiveHandler()({ id: "a", type: "task.review", title: "Ready", message: "All done", taskId: "t1" })
    expect(useNotificationStore.getState().ingest).toHaveBeenCalled()
    expect(notifySystem).toHaveBeenCalledWith({ title: "Ready", body: "All done", taskId: "t1" })
  })

  it("does not OS-notify for non-system kinds", () => {
    useAuthStore.setState({ isAuthenticated: true })
    renderHook(() => useNotificationsLifecycle())
    receiveHandler()({ id: "b", type: "comment.added", title: "Msg", message: "hi", taskId: "t1" })
    expect(useNotificationStore.getState().ingest).toHaveBeenCalled()
    expect(notifySystem).not.toHaveBeenCalled()
  })

  it("skips a duplicate push entirely", () => {
    useAuthStore.setState({ isAuthenticated: true })
    useNotificationStore.setState({ seen: new Set<string>(["dup"]) })
    renderHook(() => useNotificationsLifecycle())
    receiveHandler()({ id: "dup", type: "task.review", title: "x", message: "y", taskId: "t1" })
    expect(useNotificationStore.getState().ingest).not.toHaveBeenCalled()
    expect(notifySystem).not.toHaveBeenCalled()
  })

  it("resets the store when unauthenticated", () => {
    useAuthStore.setState({ isAuthenticated: false })
    renderHook(() => useNotificationsLifecycle())
    expect(useNotificationStore.getState().reset).toHaveBeenCalled()
  })
})
