import { act, cleanup, fireEvent, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useNewTaskShortcut } from "@/hooks/use-new-task-shortcut"
import { CREATE_TASK_EVENT, requestNewTask, takeCreateTaskRequest } from "@/lib/create-task-request"

const motion = vi.hoisted(() => ({ reduce: false }))
vi.mock("framer-motion", () => ({ useReducedMotion: () => motion.reduce }))

afterEach(() => {
  cleanup()
  takeCreateTaskRequest()
  document.body.innerHTML = ""
  vi.restoreAllMocks()
  motion.reduce = false
})

describe("New task request handoff", () => {
  it("delivers a title once, even when requested before the page mounts", () => {
    const listener = vi.fn()
    window.addEventListener(CREATE_TASK_EVENT, listener, { once: true })
    requestNewTask({ title: "Call the plumber" })
    expect(listener).toHaveBeenCalledOnce()
    expect(takeCreateTaskRequest()).toEqual({ nonce: expect.any(Number), title: "Call the plumber" })
    expect(takeCreateTaskRequest()).toBeNull()
  })

  it("expires an unanswered request after five seconds", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(10000)
    requestNewTask({ title: "Too late" })
    now.mockReturnValue(15001)
    expect(takeCreateTaskRequest()).toBeNull()
  })

  it("gives requests in the same millisecond distinct nonces", () => {
    vi.spyOn(Date, "now").mockReturnValue(20000)
    requestNewTask()
    const first = takeCreateTaskRequest()!
    requestNewTask()
    expect(takeCreateTaskRequest()!.nonce).toBeGreaterThan(first.nonce)
  })
})

describe("page-scoped New task shortcut", () => {
  it.each(["c", "с"])("asks the panel to open and focus its title for physical C (%s)", (key) => {
    const onOpen = vi.fn()
    const { result } = renderHook(() => useNewTaskShortcut({ enabled: true, onOpen }))
    fireEvent.keyDown(document.body, { key, code: "KeyC" })
    expect(onOpen).toHaveBeenCalledOnce()
    expect(result.current.titleRequest).toEqual({ nonce: expect.any(Number) })
    const previous = result.current.titleRequest!.nonce
    fireEvent.keyDown(document.body, { key, code: "KeyC" })
    expect(onOpen).toHaveBeenCalledTimes(2)
    expect(result.current.titleRequest!.nonce).toBeGreaterThan(previous)
  })

  it.each([
    { ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true },
    { isComposing: true }, { code: "KeyX" }, { repeat: true },
  ])("leaves modified, composed or unrelated keys alone: %o", (properties) => {
    const onOpen = vi.fn()
    renderHook(() => useNewTaskShortcut({ enabled: true, onOpen }))
    fireEvent.keyDown(document.body, { key: "c", code: "KeyC", ...properties })
    expect(onOpen).not.toHaveBeenCalled()
  })

  it.each(["input", "textarea", "select", "editable child"])("ignores C in %s", (tag) => {
    const onOpen = vi.fn()
    renderHook(() => useNewTaskShortcut({ enabled: true, onOpen }))
    const parent = document.createElement(tag === "editable child" ? "div" : tag)
    let target = parent
    if (tag === "editable child") {
      parent.contentEditable = "true"
      parent.setAttribute("contenteditable", "true")
      target = parent.appendChild(document.createElement("span"))
    }
    document.body.appendChild(parent)
    fireEvent.keyDown(target, { key: "c", code: "KeyC" })
    expect(onOpen).not.toHaveBeenCalled()
  })

  it.each(["dialog", "alertdialog", "menu", "listbox"])("ignores C behind a %s even from body", (role) => {
    const onOpen = vi.fn()
    renderHook(() => useNewTaskShortcut({ enabled: true, onOpen }))
    const overlay = document.body.appendChild(document.createElement("div"))
    overlay.setAttribute("role", role)
    fireEvent.keyDown(document.body, { key: "c", code: "KeyC" })
    expect(onOpen).not.toHaveBeenCalled()
    overlay.hidden = true
    fireEvent.keyDown(document.body, { key: "c", code: "KeyC" })
    expect(onOpen).toHaveBeenCalledOnce()
  })

  it("does nothing while the page disables shortcuts, then consumes the waiting palette title", () => {
    const onOpen = vi.fn()
    const { result, rerender } = renderHook(({ enabled }) => useNewTaskShortcut({ enabled, onOpen }), { initialProps: { enabled: false } })
    fireEvent.keyDown(document.body, { code: "KeyC", key: "c" })
    act(() => requestNewTask({ title: "From another page" }))
    expect(onOpen).not.toHaveBeenCalled()
    rerender({ enabled: true })
    expect(onOpen).toHaveBeenCalledOnce()
    expect(result.current.titleRequest).toMatchObject({ title: "From another page" })
  })

  it("accepts a palette title while its dialog is exiting, independently of keyboard guards", () => {
    const onOpen = vi.fn()
    const { result } = renderHook(() => useNewTaskShortcut({ enabled: true, onOpen }))
    const palette = document.body.appendChild(document.createElement("div"))
    palette.setAttribute("role", "dialog")
    act(() => requestNewTask({ title: "Buy milk" }))
    expect(onOpen).toHaveBeenCalledOnce()
    expect(result.current.titleRequest).toMatchObject({ title: "Buy milk" })
  })

  it.each([false, true])("scrolls an off-screen panel with reduced motion = %s", async (reduce) => {
    motion.reduce = reduce
    const { result } = renderHook(() => useNewTaskShortcut({ enabled: true, onOpen: vi.fn() }))
    const panel = document.body.appendChild(document.createElement("div"))
    panel.getBoundingClientRect = () => new DOMRect(0, -300, 800, 100)
    panel.scrollIntoView = vi.fn()
    Object.assign(result.current.panelRef, { current: panel })
    fireEvent.keyDown(document.body, { code: "KeyC", key: "c" })
    await waitFor(() => expect(panel.scrollIntoView).toHaveBeenCalledWith({ behavior: reduce ? "auto" : "smooth", block: "nearest" }))
  })
})
