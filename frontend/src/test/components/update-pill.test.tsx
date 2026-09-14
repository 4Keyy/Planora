import { createRef } from "react"
import { act, render, renderHook, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { UpdatePill, useDeferredUpdates } from "@/components/ui/update-pill"

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    media: "",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }) as unknown as typeof window.matchMedia
})

afterEach(() => {
  scrollWindowTo(0)
  vi.restoreAllMocks()
})

/**
 * jsdom has no layout: it never updates `scrollY` and never fires `scroll` of its
 * own, so the position has to be written and the event thrown by hand.
 */
function scrollWindowTo(y: number): void {
  Object.defineProperty(window, "scrollY", { value: y, writable: true, configurable: true })
  window.dispatchEvent(new Event("scroll"))
}

function scrollElementTo(element: HTMLElement, top: number): void {
  Object.defineProperty(element, "scrollTop", { value: top, writable: true, configurable: true })
  element.dispatchEvent(new Event("scroll"))
}

// ─── UpdatePill ─────────────────────────────────────────────────────────────

describe("UpdatePill", () => {
  it("offers nothing, announces nothing and takes no space when the count is zero", () => {
    // Not an empty pill and — the one that matters — not an empty live region: a
    // region mounted before there is anything to say is the region that later
    // fails to announce, because browsers disagree about text appearing in a node
    // that was already on the page.
    //
    // What IS left behind is the zero-height sticky strip, and deliberately. The
    // presence boundary has to outlive the thing that animates: returning null
    // here took the AnimatePresence with it and the exit never ran once. An empty
    // `h-0` container occupies nothing, holds nothing focusable and says nothing.
    const { container } = render(<UpdatePill count={0} onShow={vi.fn()} />)
    expect(container.textContent).toBe("")
    expect(container.querySelector(".sr-only")).toBeNull()
    expect(container.firstElementChild).toBeEmptyDOMElement()
    expect(container.firstElementChild).toHaveClass("h-0")
    expect(screen.queryByRole("button")).toBeNull()
    expect(screen.queryByRole("status")).toBeNull()
  })

  it("names itself with the count and the singular noun", () => {
    render(<UpdatePill count={1} onShow={vi.fn()} noun="new task" />)
    expect(screen.getByRole("button", { name: "Show 1 new task" })).toBeInTheDocument()
  })

  it("pluralises the noun for more than one", () => {
    render(<UpdatePill count={3} onShow={vi.fn()} noun="new task" />)
    expect(screen.getByRole("button", { name: "Show 3 new tasks" })).toBeInTheDocument()
  })

  it("asks to be shown when pressed", async () => {
    const onShow = vi.fn()
    render(<UpdatePill count={2} onShow={onShow} noun="new task" />)
    await userEvent.click(screen.getByRole("button", { name: "Show 2 new tasks" }))
    expect(onShow).toHaveBeenCalledTimes(1)
  })

  it("announces that updates exist, without the count", async () => {
    // The digits must live outside the live region. An aria-live region wrapped
    // around a realtime counter re-announces on every tick, each interruption
    // cutting off the last — a screen-reader denial of service driven by other
    // people's typing.
    render(<UpdatePill count={4} onShow={vi.fn()} noun="new task" />)
    const status = await screen.findByRole("status")
    await waitFor(() => expect(status).toHaveTextContent("There is something new at the top of the list."))

    expect(status).toHaveAttribute("aria-live", "polite")
    expect(status.textContent).not.toMatch(/\d/)
    expect(within(status).queryByText("4")).toBeNull()
  })

  it("does not re-announce as the count climbs", async () => {
    // One batch, one announcement. Ten arrivals must not cost ten interruptions.
    const { rerender } = render(<UpdatePill count={1} onShow={vi.fn()} noun="new task" />)
    const status = await screen.findByRole("status")
    await waitFor(() => expect(status).toHaveTextContent("There is something new at the top of the list."))
    const announced = status.textContent

    rerender(<UpdatePill count={5} onShow={vi.fn()} noun="new task" />)
    // Same node, same words — nothing for the region to fire on.
    expect(screen.getByRole("status")).toBe(status)
    expect(status.textContent).toBe(announced)
    // The count did change; it changed on the button's name, which is read on
    // arrival rather than shouted.
    expect(screen.getByRole("button", { name: "Show 5 new tasks" })).toBeInTheDocument()
  })
})

// ─── useDeferredUpdates ─────────────────────────────────────────────────────

describe("useDeferredUpdates", () => {
  it("applies straight away at the top of an idle list", () => {
    // At the top an insert pushes content down without moving anything the
    // pointer is aimed at, so deferring it would be pure staleness for nothing.
    const onApply = vi.fn()
    const { result } = renderHook(() => useDeferredUpdates<string>({ onApply }))

    act(() => result.current.push("a"))

    expect(onApply).toHaveBeenCalledWith(["a"])
    expect(result.current.pending).toEqual([])
    expect(result.current.count).toBe(0)
  })

  it("queues once the list is scrolled away from the top", () => {
    // Inserting above the viewport moves every row under the pointer: the click
    // the user had already committed to lands on the wrong task.
    const onApply = vi.fn()
    const { result } = renderHook(() => useDeferredUpdates<string>({ onApply }))

    act(() => scrollWindowTo(600))
    act(() => result.current.push("a"))
    act(() => result.current.push("b"))

    expect(onApply).not.toHaveBeenCalled()
    expect(result.current.pending).toEqual(["a", "b"])
    expect(result.current.count).toBe(2)
  })

  it("queues while busy even at the very top", () => {
    // A half-typed composer must never be disturbed, however safe the scroll
    // position looks.
    const onApply = vi.fn()
    const { result } = renderHook(() => useDeferredUpdates<string>({ busy: true, onApply }))

    expect(result.current.canApplyLive).toBe(false)
    act(() => result.current.push("a"))

    expect(onApply).not.toHaveBeenCalled()
    expect(result.current.pending).toEqual(["a"])
  })

  it("keeps deciding with today's busy flag, not the one it was mounted with", () => {
    // `push` is handed to a realtime subscription registered once. If it read
    // `busy` through a closure it would answer "not busy" forever.
    const onApply = vi.fn()
    const { result, rerender } = renderHook(
      ({ busy }: { busy: boolean }) => useDeferredUpdates<string>({ busy, onApply }),
      { initialProps: { busy: false } }
    )
    const push = result.current.push

    rerender({ busy: true })
    act(() => push("a"))

    expect(onApply).not.toHaveBeenCalled()
    expect(result.current.pending).toEqual(["a"])
  })

  it("flushes the queue in arrival order and returns to the top when shown", () => {
    const onApply = vi.fn()
    const scrollTo = vi.fn()
    window.scrollTo = scrollTo as unknown as typeof window.scrollTo
    const { result } = renderHook(() => useDeferredUpdates<string>({ onApply }))

    act(() => scrollWindowTo(600))
    act(() => {
      result.current.push("a")
      result.current.push("b")
    })
    act(() => result.current.show())

    expect(onApply).toHaveBeenCalledTimes(1)
    expect(onApply).toHaveBeenCalledWith(["a", "b"])
    expect(result.current.pending).toEqual([])
    expect(result.current.count).toBe(0)
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }))
  })

  it("scrolls its own container rather than the window when given one", () => {
    const scrollTo = vi.fn()
    Element.prototype.scrollTo = scrollTo as unknown as typeof Element.prototype.scrollTo
    const windowScrollTo = vi.fn()
    window.scrollTo = windowScrollTo as unknown as typeof window.scrollTo

    const ref = createRef<HTMLElement>()
    const container = document.createElement("div")
    document.body.appendChild(container)
    Object.defineProperty(ref, "current", { value: container, writable: true })

    const onApply = vi.fn()
    const { result } = renderHook(() => useDeferredUpdates<string>({ scrollRef: ref, onApply }))

    act(() => scrollElementTo(container, 800))
    expect(result.current.canApplyLive).toBe(false)

    act(() => result.current.push("a"))
    expect(onApply).not.toHaveBeenCalled()

    act(() => result.current.show())
    expect(onApply).toHaveBeenCalledWith(["a"])
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }))
    expect(windowScrollTo).not.toHaveBeenCalled()

    container.remove()
  })

  it("discards the queue without applying it when cleared", () => {
    // The caller that has just refetched already has these items; replaying them
    // would insert every one of them a second time.
    const onApply = vi.fn()
    const { result } = renderHook(() => useDeferredUpdates<string>({ onApply }))

    act(() => scrollWindowTo(600))
    act(() => result.current.push("a"))
    expect(result.current.count).toBe(1)

    act(() => result.current.clear())

    expect(onApply).not.toHaveBeenCalled()
    expect(result.current.pending).toEqual([])
    expect(result.current.count).toBe(0)
  })

  it("reports canApplyLive only when both conditions hold", () => {
    const { result, rerender } = renderHook(
      ({ busy }: { busy: boolean }) => useDeferredUpdates<string>({ busy }),
      { initialProps: { busy: false } }
    )
    expect(result.current.canApplyLive).toBe(true)

    rerender({ busy: true })
    expect(result.current.canApplyLive).toBe(false)

    rerender({ busy: false })
    act(() => scrollWindowTo(600))
    expect(result.current.canApplyLive).toBe(false)

    act(() => scrollWindowTo(0))
    expect(result.current.canApplyLive).toBe(true)
  })

  it("counts a tap that lands just under the threshold as the top", () => {
    // 24px of slack: a list nudged a few pixels by the pill itself is still "top".
    const onApply = vi.fn()
    const { result } = renderHook(() => useDeferredUpdates<string>({ threshold: 24, onApply }))

    act(() => scrollWindowTo(24))
    expect(result.current.canApplyLive).toBe(true)

    act(() => scrollWindowTo(25))
    expect(result.current.canApplyLive).toBe(false)
  })

  it("leaves the queue alone when the user merely scrolls back to the top", () => {
    // Scrolling up to re-read something is not a request for the list to change,
    // and a pill that vanished unpressed would leave them wondering what they
    // missed.
    const onApply = vi.fn()
    const { result } = renderHook(() => useDeferredUpdates<string>({ onApply }))

    act(() => scrollWindowTo(600))
    act(() => result.current.push("a"))
    act(() => scrollWindowTo(0))

    expect(onApply).not.toHaveBeenCalled()
    expect(result.current.count).toBe(1)
  })
})
