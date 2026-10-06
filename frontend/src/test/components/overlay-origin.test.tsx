import { useMemo } from "react"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Overlay } from "@/components/ui/overlay"
import { SPRING_LAYOUT, TWEEN_FAST } from "@/lib/animations"
import { forgetOrigin, rememberOrigin, takeOrigin } from "@/lib/shared-origin"

const motionCalls = vi.hoisted(() => ({
  set: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  reduce: false,
  controllers: new Set<import("framer-motion").AnimationControls>(),
}))

vi.mock("framer-motion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("framer-motion")>()
  return {
    ...actual,
    useReducedMotion: () => motionCalls.reduce,
    useAnimationControls: () => {
      const controls = actual.useAnimationControls()
      motionCalls.controllers.add(controls)
      return useMemo(() => ({
        ...controls,
        set: (...args: Parameters<typeof controls.set>) => {
          motionCalls.set(...args)
          return controls.set(...args)
        },
        start: (...args: Parameters<typeof controls.start>) => {
          motionCalls.start(...args)
          return controls.start(...args)
        },
        stop: () => {
          motionCalls.stop()
          return controls.stop()
        },
      }), [controls])
    },
  }
})

const resting = { opacity: 1, scale: 1, x: 0, y: 0 }
const dialogStarts = () => motionCalls.start.mock.calls.filter(([target]) => "scale" in target).length

function recordCard(left = 40, top = 120) {
  const card = document.createElement("button")
  Object.defineProperty(card, "getBoundingClientRect", { value: () => new DOMRect(left, top, 350, 120) })
  rememberOrigin(card)
}

beforeEach(() => {
  vi.clearAllMocks()
  motionCalls.reduce = false
  motionCalls.controllers.clear()
  forgetOrigin()
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return this.getAttribute("role") === "dialog"
      ? new DOMRect(336, 200, 768, 500)
      : new DOMRect()
  })
})

afterEach(() => {
  forgetOrigin()
  vi.restoreAllMocks()
})

describe("Overlay opening from a card", () => {
  it("grows from the pressed card to its measured natural size with the task editor's spring", () => {
    recordCard()
    render(<Overlay open animateFromOrigin onClose={vi.fn()} title="Edit category" className="max-w-3xl">body</Overlay>)

    expect(motionCalls.set).toHaveBeenCalledWith({ opacity: 0, scale: 0.55, x: -505, y: -270 })
    expect(motionCalls.start).toHaveBeenCalledWith(resting, SPRING_LAYOUT)
    const dialog = screen.getByRole("dialog")
    expect(dialog).toHaveClass("max-w-3xl")
    expect(dialog.style.height).toBe("")
    expect(dialog.style.animation).toBe("none")
    expect(takeOrigin()).toBeNull()
  })

  it("uses the task editor's centred entrance when no card supplied an origin", () => {
    render(<Overlay open animateFromOrigin onClose={vi.fn()} title="Edit">body</Overlay>)
    expect(motionCalls.set).toHaveBeenCalledWith({ opacity: 0, scale: 0.95, x: 0, y: 20 })
    expect(motionCalls.start).toHaveBeenCalledWith(resting, SPRING_LAYOUT)
  })

  it("consumes the next card on each open edge, including reopening during the CSS exit", () => {
    const onClose = vi.fn()
    const view = render(<Overlay open={false} animateFromOrigin onClose={onClose} title="Edit">body</Overlay>)
    recordCard()
    view.rerender(<Overlay open animateFromOrigin onClose={onClose} title="Edit">body</Overlay>)
    expect(dialogStarts()).toBe(1)

    view.rerender(<Overlay open={false} animateFromOrigin onClose={onClose} title="Edit">body</Overlay>)
    recordCard(400, 300)
    view.rerender(<Overlay open animateFromOrigin onClose={onClose} title="Edit">body</Overlay>)

    expect(motionCalls.set).toHaveBeenLastCalledWith({ opacity: 0, scale: 0.55, x: -145, y: -90 })
    expect(dialogStarts()).toBe(2)
    expect(takeOrigin()).toBeNull()
  })

  it("measures the untransformed panel when reopening before motion has flushed the previous frame", () => {
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (this: HTMLElement) {
      if (this.getAttribute("role") !== "dialog") return new DOMRect()
      return this.style.transform && this.style.transform !== "none"
        ? new DOMRect(336 - 150, 200 - 100, 768 * 0.6, 500 * 0.6)
        : new DOMRect(336, 200, 768, 500)
    })
    recordCard()
    const onClose = vi.fn()
    const view = render(<Overlay open animateFromOrigin onClose={onClose} title="Edit">body</Overlay>)
    view.rerender(<Overlay open={false} animateFromOrigin onClose={onClose} title="Edit">body</Overlay>)
    // controls.set updates MotionValues now, but their DOM write can wait until RAF.
    screen.getByRole("dialog").style.transform = "translate(-150px, -100px) scale(0.6)"
    recordCard(400, 300)
    view.rerender(<Overlay open animateFromOrigin onClose={onClose} title="Edit">body</Overlay>)

    expect(motionCalls.set).toHaveBeenLastCalledWith({ opacity: 0, scale: 0.55, x: -145, y: -90 })
  })

  it("keeps its origin when content rerenders during autosave", () => {
    recordCard()
    const onClose = vi.fn()
    const view = render(<Overlay open animateFromOrigin onClose={onClose} title="Edit">old content</Overlay>)
    view.rerender(<Overlay open animateFromOrigin onClose={onClose} title="Edit">saved content</Overlay>)
    expect(dialogStarts()).toBe(1)
    expect(screen.getByText("saved content")).toBeInTheDocument()
  })

  it("leaves ordinary overlays and create-category entrances on their existing CSS animation", () => {
    recordCard()
    render(<Overlay open onClose={vi.fn()} title="New category">body</Overlay>)
    expect(motionCalls.start).not.toHaveBeenCalled()
    expect(screen.getByRole("dialog").style.animation).toBe("")
    expect(screen.getByRole("dialog")).toHaveClass("dialog-surface")
    expect(takeOrigin()).not.toBeNull()
  })

  it("consumes the card but removes travel and scale for reduced motion", () => {
    motionCalls.reduce = true
    recordCard()
    render(<Overlay open animateFromOrigin onClose={vi.fn()} title="Edit">body</Overlay>)
    expect(motionCalls.set).toHaveBeenCalledWith({ opacity: 0, scale: 1, x: 0, y: 0 })
    expect(motionCalls.start).toHaveBeenCalledWith(resting, SPRING_LAYOUT)
    expect(takeOrigin()).toBeNull()
  })

  it("stops the entrance and retains the original CSS fold-away until animationend", () => {
    recordCard()
    const onClose = vi.fn()
    const view = render(<Overlay open animateFromOrigin onClose={onClose} title="Edit">body</Overlay>)
    const entranceSetCount = motionCalls.set.mock.calls.length
    view.rerender(<Overlay open={false} animateFromOrigin onClose={onClose} title="Edit">body</Overlay>)

    const dialog = screen.getByRole("dialog")
    expect(motionCalls.stop).toHaveBeenCalled()
    expect(motionCalls.set).toHaveBeenCalledTimes(entranceSetCount)
    expect(dialog).toHaveAttribute("data-state", "closed")
    expect(dialog.style.animation).toBe("")
    expect(dialog.parentElement).toHaveClass("pointer-events-none")
    fireEvent.animationEnd(dialog)
    fireEvent(dialog, new Event("webkitAnimationEnd", { bubbles: true }))
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("keeps the current pose and opacity when closing during the entrance", async () => {
    recordCard()
    const onClose = vi.fn()
    const view = render(<Overlay open animateFromOrigin onClose={onClose} title="Edit">body</Overlay>)
    const dialog = screen.getByRole("dialog")
    const controls = Array.from(motionCalls.controllers).at(-1)!
    act(() => {
      controls.stop()
      controls.set({ opacity: 0.42, x: -220, y: -80, scale: 0.72 })
    })
    await waitFor(() => expect(dialog.style.opacity).toBe("0.42"))
    const transformAtClose = dialog.style.transform
    expect(transformAtClose).toContain("0.72")

    view.rerender(<Overlay open={false} animateFromOrigin onClose={onClose} title="Edit">body</Overlay>)
    await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
    // CSS takes over from this pose; jumping to opacity1/scale1/centre would flash.
    expect(dialog.style.opacity).toBe("0.42")
    expect(dialog.style.transform).toBe(transformAtClose)
    expect(dialog).toHaveAttribute("data-state", "closed")
  })

  it.each([false, true])("opens its backdrop with the task editor's TWEEN_FAST (reduced motion: %s)", (reduce) => {
    motionCalls.reduce = reduce
    recordCard()
    const onClose = vi.fn()
    const view = render(<Overlay open animateFromOrigin onClose={onClose} title="Edit">body</Overlay>)
    const backdrop = document.querySelector<HTMLElement>(".backdrop-surface")!
    expect(motionCalls.start).toHaveBeenCalledWith({ opacity: 1 }, TWEEN_FAST)
    expect(backdrop.style.animation).toBe("none")
    expect(backdrop).toHaveAttribute("data-state", "open")
    expect(backdrop).toHaveAttribute("aria-hidden", "true")
    view.rerender(<Overlay open={false} animateFromOrigin onClose={onClose} title="Edit">body</Overlay>)
    expect(backdrop.style.animation).toBe("")
    expect(backdrop).toHaveAttribute("data-state", "closed")
  })

  it("keeps focus trapped and restores it to the category trigger on close", async () => {
    const onClose = vi.fn()
    const trigger = document.createElement("button")
    document.body.append(trigger)
    trigger.focus()
    recordCard()
    const view = render(<Overlay open animateFromOrigin onClose={onClose} title="Edit"><button>first</button><button>last</button></Overlay>)
    await waitFor(() => expect(screen.getByRole("button", { name: "first" })).toHaveFocus())
    await userEvent.tab()
    await userEvent.tab()
    expect(screen.getByRole("button", { name: "first" })).toHaveFocus()
    view.rerender(<Overlay open={false} animateFromOrigin onClose={onClose} title="Edit">body</Overlay>)
    expect(trigger).toHaveFocus()
    trigger.remove()
  })
})
