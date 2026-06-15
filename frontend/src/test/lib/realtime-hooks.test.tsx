import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useAuthStore } from "@/store/auth"
import {
  useRealtimeLifecycle,
  useFeedSync,
  useBranchRoom,
  useTyping,
} from "@/lib/realtime/hooks"

// ── Mock the singleton realtime client ──────────────────────────────────────
// `on` records handlers per event so tests can emit server events synchronously.
const rt = vi.hoisted(() => {
  const handlers: Record<string, Set<(p: unknown) => void>> = {}
  return {
    handlers,
    on: vi.fn((event: string, cb: (p: unknown) => void) => {
      ;(handlers[event] ??= new Set()).add(cb)
      return () => handlers[event]?.delete(cb)
    }),
    start: vi.fn(() => Promise.resolve()),
    stop: vi.fn(() => Promise.resolve()),
    joinTask: vi.fn(() => Promise.resolve()),
    leaveTask: vi.fn(() => Promise.resolve()),
    startTyping: vi.fn(() => Promise.resolve()),
    stopTyping: vi.fn(() => Promise.resolve()),
    emit(event: string, payload: unknown) {
      handlers[event]?.forEach((cb) => cb(payload))
    },
  }
})

vi.mock("@/lib/realtime/client", () => ({ realtime: rt }))

beforeEach(() => {
  vi.clearAllMocks()
  for (const key of Object.keys(rt.handlers)) delete rt.handlers[key]
})

afterEach(() => {
  vi.useRealTimers()
})

describe("useRealtimeLifecycle", () => {
  it("starts the connection while authenticated with a token", () => {
    useAuthStore.setState({ isAuthenticated: true, accessToken: "tok" })
    renderHook(() => useRealtimeLifecycle())
    expect(rt.start).toHaveBeenCalled()
    expect(rt.stop).not.toHaveBeenCalled()
  })

  it("stops the connection when not authenticated", () => {
    useAuthStore.setState({ isAuthenticated: false, accessToken: undefined })
    renderHook(() => useRealtimeLifecycle())
    expect(rt.stop).toHaveBeenCalled()
    expect(rt.start).not.toHaveBeenCalled()
  })
})

describe("useFeedSync", () => {
  it("invokes the latest handler on TaskFeedChanged and unsubscribes on unmount", () => {
    const handler = vi.fn()
    const { unmount } = renderHook(() => useFeedSync(handler))

    act(() => rt.emit("TaskFeedChanged", { action: "task.updated", taskId: "t1", actorId: "u2", timestamp: "" }))
    expect(handler).toHaveBeenCalledTimes(1)

    unmount()
    act(() => rt.emit("TaskFeedChanged", { action: "task.updated", taskId: "t1", actorId: "u2", timestamp: "" }))
    expect(handler).toHaveBeenCalledTimes(1)
  })
})

describe("useBranchRoom", () => {
  it("joins the room, forwards only matching-task events, and leaves on unmount", async () => {
    const handler = vi.fn()
    const { unmount } = renderHook(() => useBranchRoom("task-1", handler))

    await act(async () => { await Promise.resolve() })
    expect(rt.start).toHaveBeenCalled()
    expect(rt.joinTask).toHaveBeenCalledWith("task-1")

    act(() => rt.emit("BranchChanged", { taskId: "task-1", entityId: "c1", actorId: "u2", action: "comment.added", timestamp: "" }))
    expect(handler).toHaveBeenCalledTimes(1)

    // Event for a different task is ignored.
    act(() => rt.emit("BranchChanged", { taskId: "other", entityId: "c2", actorId: "u2", action: "comment.added", timestamp: "" }))
    expect(handler).toHaveBeenCalledTimes(1)

    unmount()
    expect(rt.leaveTask).toHaveBeenCalledWith("task-1")
  })

  it("is a no-op without a task id", () => {
    renderHook(() => useBranchRoom(null, vi.fn()))
    expect(rt.joinTask).not.toHaveBeenCalled()
  })
})

describe("useTyping", () => {
  it("tracks others' typing, drops them on stop, and expires stale indicators", () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useTyping("task-1", true))

    act(() => rt.emit("UserTyping", { taskId: "task-1", userId: "u2", name: "Ada Lovelace" }))
    expect(result.current.typingNames).toEqual(["Ada Lovelace"])

    // Event for another room is ignored.
    act(() => rt.emit("UserTyping", { taskId: "other", userId: "u9", name: "Nope" }))
    expect(result.current.typingNames).toEqual(["Ada Lovelace"])

    act(() => rt.emit("UserStoppedTyping", { taskId: "task-1", userId: "u2" }))
    expect(result.current.typingNames).toEqual([])

    // A typing signal with no name falls back to "Someone", and a missed stop self-expires via TTL.
    act(() => rt.emit("UserTyping", { taskId: "task-1", userId: "u3" }))
    expect(result.current.typingNames).toEqual(["Someone"])
    act(() => vi.advanceTimersByTime(7_000))
    expect(result.current.typingNames).toEqual([])
  })

  it("throttles StartTyping and schedules a StopTyping after idle", () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useTyping("task-1", true))

    act(() => result.current.notifyTyping())
    act(() => result.current.notifyTyping())
    // Throttled: only one StartTyping despite two keystrokes.
    expect(rt.startTyping).toHaveBeenCalledTimes(1)

    act(() => vi.advanceTimersByTime(3_500))
    expect(rt.stopTyping).toHaveBeenCalledWith("task-1")
  })

  it("does nothing when disabled", () => {
    const { result } = renderHook(() => useTyping("task-1", false))
    act(() => result.current.notifyTyping())
    expect(rt.startTyping).not.toHaveBeenCalled()
    expect(result.current.typingNames).toEqual([])
  })

  it("stops typing on unmount while active", () => {
    const { unmount } = renderHook(() => useTyping("task-1", true))
    unmount()
    expect(rt.stopTyping).toHaveBeenCalledWith("task-1")
  })
})
