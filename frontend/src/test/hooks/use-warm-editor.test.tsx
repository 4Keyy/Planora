import { renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const editor = vi.hoisted(() => ({ load: vi.fn(() => Promise.resolve({})) }))

vi.mock("@/components/todos/edit-todo-modal/lazy", () => ({ loadEditor: editor.load }))

import { useWarmEditor } from "@/hooks/use-warm-editor"

describe("useWarmEditor", () => {
  const idleCallbacks: IdleRequestCallback[] = []
  const realIdle = window.requestIdleCallback
  const realCancel = window.cancelIdleCallback

  beforeEach(() => {
    editor.load.mockClear()
    idleCallbacks.length = 0
    window.requestIdleCallback = vi.fn((callback: IdleRequestCallback) => {
      idleCallbacks.push(callback)
      return idleCallbacks.length
    }) as typeof window.requestIdleCallback
    window.cancelIdleCallback = vi.fn() as typeof window.cancelIdleCallback
  })

  afterEach(() => {
    window.requestIdleCallback = realIdle
    window.cancelIdleCallback = realCancel
    vi.useRealTimers()
  })

  it("fetches the editor once the page is idle, and lets go of the press listener", () => {
    const remove = vi.spyOn(window, "removeEventListener")
    renderHook(() => useWarmEditor())
    expect(window.requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), { timeout: 2000 })
    idleCallbacks[0]({ didTimeout: false, timeRemaining: () => 10 })
    expect(editor.load).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledWith("pointerdown", expect.any(Function), true)
  })

  it("shrugs off a chunk that cannot be fetched: the open fetches it again", async () => {
    editor.load.mockReturnValueOnce(Promise.reject(new Error("offline")))
    renderHook(() => useWarmEditor())
    idleCallbacks[0]({ didTimeout: false, timeRemaining: () => 10 })
    await Promise.resolve()
    expect(editor.load).toHaveBeenCalledTimes(1)
  })

  it("fetches it at the first press when that comes before the page is idle, and only once", () => {
    renderHook(() => useWarmEditor())
    window.dispatchEvent(new Event("pointerdown"))
    window.dispatchEvent(new Event("pointerdown"))
    expect(window.cancelIdleCallback).toHaveBeenCalledTimes(1)
    expect(editor.load).toHaveBeenCalledTimes(1)
  })

  it("stops waiting when the page goes away first", () => {
    const { unmount } = renderHook(() => useWarmEditor())
    unmount()
    expect(window.cancelIdleCallback).toHaveBeenCalledWith(1)
  })

  it("falls back to a timer where there is no idle callback", () => {
    vi.useFakeTimers()
    // @ts-expect-error — a browser without requestIdleCallback
    window.requestIdleCallback = undefined
    const timeout = vi.spyOn(window, "setTimeout")
    const clear = vi.spyOn(window, "clearTimeout")
    const { unmount } = renderHook(() => useWarmEditor())
    expect(timeout).toHaveBeenCalledWith(expect.any(Function), 1200)
    unmount()
    expect(clear).toHaveBeenCalled()
  })
})
