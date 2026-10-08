import { act } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TOAST_DURATIONS, TOAST_LIMIT, useToastStore } from "@/store/toast"

const store = () => useToastStore.getState()

describe("toast store", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    store().clear()
  })
  afterEach(() => {
    store().clear()
    vi.useRealTimers()
  })

  it("keeps each kind on screen for its own reading time, longer with a description", () => {
    act(() => {
      store().addToast({ type: "success", title: "Saved" })
      store().addToast({ type: "error", title: "Failed", description: "The server did not answer." })
    })
    act(() => vi.advanceTimersByTime(TOAST_DURATIONS.success + 10))
    expect(store().toasts.map((t) => t.title)).toEqual(["Failed"])
    act(() => vi.advanceTimersByTime(TOAST_DURATIONS.error + 1500 - TOAST_DURATIONS.success))
    expect(store().toasts).toHaveLength(0)
  })

  it("counts the same notice said again instead of stacking a copy, and restarts its clock", () => {
    act(() => {
      store().addToast({ type: "error", title: "Couldn't load tasks" })
    })
    act(() => vi.advanceTimersByTime(TOAST_DURATIONS.error - 100))
    act(() => {
      store().addToast({ type: "error", title: "Couldn't load tasks" })
    })
    expect(store().toasts).toHaveLength(1)
    expect(store().toasts[0].count).toBe(2)
    act(() => vi.advanceTimersByTime(200))
    expect(store().toasts).toHaveLength(1)
  })

  it("stops every clock while the stack is being read, and starts them where they stopped", () => {
    act(() => {
      store().addToast({ type: "success", title: "Saved" })
    })
    act(() => vi.advanceTimersByTime(1000))
    act(() => store().pause())
    act(() => vi.advanceTimersByTime(60_000))
    expect(store().toasts).toHaveLength(1)
    act(() => store().resume())
    act(() => vi.advanceTimersByTime(TOAST_DURATIONS.success - 1000 - 10))
    expect(store().toasts).toHaveLength(1)
    act(() => vi.advanceTimersByTime(20))
    expect(store().toasts).toHaveLength(0)
  })

  it("tells a notice its clock stopped and started", () => {
    const onPause = vi.fn()
    const onResume = vi.fn()
    act(() => {
      store().addToast({ type: "info", title: "Task deleted", onPause, onResume })
    })
    act(() => store().pause())
    act(() => store().resume())
    expect(onPause).toHaveBeenCalledTimes(1)
    expect(onResume).toHaveBeenCalledTimes(1)
  })

  it("runs an action once and dismisses without calling onDismiss", () => {
    const onClick = vi.fn()
    const onDismiss = vi.fn()
    let id = ""
    act(() => {
      id = store().addToast({ type: "info", title: "Task deleted", action: { label: "Undo", onClick }, onDismiss })
    })
    act(() => store().actOn(id))
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onDismiss).not.toHaveBeenCalled()
    expect(store().toasts).toHaveLength(0)
  })

  it("calls onDismiss when a notice is closed or runs out", () => {
    const onDismiss = vi.fn()
    act(() => {
      store().addToast({ type: "success", title: "Saved", onDismiss })
    })
    act(() => vi.advanceTimersByTime(TOAST_DURATIONS.success + 10))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it("changes a notice in place by id, restarting its clock when its kind changes", () => {
    act(() => {
      store().addToast({ id: "save", type: "info", title: "Saving…", duration: Infinity })
    })
    act(() => vi.advanceTimersByTime(60_000))
    expect(store().toasts).toHaveLength(1)
    act(() => store().updateToast("save", { type: "success", title: "Saved", duration: undefined }))
    expect(store().toasts[0]).toMatchObject({ id: "save", title: "Saved", type: "success" })
    act(() => vi.advanceTimersByTime(TOAST_DURATIONS.success + 10))
    expect(store().toasts).toHaveLength(0)
  })

  it("lets the oldest go once more than the limit are showing", () => {
    act(() => {
      for (let i = 0; i <= TOAST_LIMIT; i++) store().addToast({ type: "info", title: `Notice ${i}` })
    })
    expect(store().toasts).toHaveLength(TOAST_LIMIT)
    expect(store().toasts[0].title).toBe("Notice 1")
  })
})
