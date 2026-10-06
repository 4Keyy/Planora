import { useMemo } from "react"
import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Overlay } from "@/components/ui/overlay"
import { DURATION_FAST, DURATION_UI, EASE_STANDARD, SPRING_LAYOUT, TWEEN_FAST } from "@/lib/animations"
import { forgetOrigin, rememberOrigin, takeOrigin } from "@/lib/shared-origin"

const motionCalls = vi.hoisted(() => ({
  set: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  reduce: false,
  deferExits: false,
  exitResolvers: [] as Array<() => void>,
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
          if (motionCalls.deferExits && typeof args[0] === "object" && "opacity" in args[0] && args[0].opacity === 0) {
            return new Promise<void>((resolve) => motionCalls.exitResolvers.push(resolve))
          }
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
  motionCalls.deferExits = false
  motionCalls.exitResolvers = []
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

  it("consumes the next card on each open edge, including reopening during the exit", () => {
    const onClose = vi.fn()
    const view = render(<Overlay open={false} animateFromOrigin onClose={onClose} title="Edit">body</Overlay>)
    recordCard()
    view.rerender(<Overlay open animateFromOrigin onClose={onClose} title="Edit">body</Overlay>)
    expect(dialogStarts()).toBe(1)

    view.rerender(<Overlay open={false} animateFromOrigin onClose={onClose} title="Edit">body</Overlay>)
    recordCard(400, 300)
    view.rerender(<Overlay open animateFromOrigin onClose={onClose} title="Edit">body</Overlay>)

    expect(motionCalls.set).toHaveBeenLastCalledWith({ opacity: 0, scale: 0.55, x: -145, y: -90 })
    expect(dialogStarts()).toBe(3)
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

  it("ignores an old exit completion after reopening and closing again", async () => {
    motionCalls.deferExits = true
    recordCard()
    const onClose = vi.fn()
    const view = render(<Overlay open animateFromOrigin onClose={onClose} title="Edit">body</Overlay>)
    view.rerender(<Overlay open={false} animateFromOrigin onClose={onClose} title="Edit">body</Overlay>)
    const finishOldDialogExit = motionCalls.exitResolvers.at(-1)!
    recordCard(400, 300)
    view.rerender(<Overlay open animateFromOrigin onClose={onClose} title="Edit">body</Overlay>)
    view.rerender(<Overlay open={false} animateFromOrigin onClose={onClose} title="Edit">body</Overlay>)
    const finishCurrentDialogExit = motionCalls.exitResolvers.at(-1)!

    await act(async () => finishOldDialogExit())
    expect(screen.getByRole("dialog")).toHaveAttribute("data-state", "closed")
    await act(async () => finishCurrentDialogExit())
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("leaves ordinary overlays on their existing CSS animation", () => {
    recordCard()
    render(<Overlay open onClose={vi.fn()} title="Other dialog">body</Overlay>)
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

  it("returns to the pressed card with the task editor's exit and unmounts when it finishes", async () => {
    recordCard()
    const onClose = vi.fn()
    const view = render(<Overlay open animateFromOrigin onClose={onClose} title="Edit">body</Overlay>)
    const entranceSetCount = motionCalls.set.mock.calls.length
    view.rerender(<Overlay open={false} animateFromOrigin onClose={onClose} title="Edit">body</Overlay>)

    const dialog = screen.getByRole("dialog")
    expect(motionCalls.stop).toHaveBeenCalled()
    expect(motionCalls.set).toHaveBeenCalledTimes(entranceSetCount)
    expect(dialog).toHaveAttribute("data-state", "closed")
    expect(motionCalls.start).toHaveBeenLastCalledWith(
      { opacity: 0, scale: 0.55, x: -505, y: -270 },
      { duration: DURATION_UI, ease: EASE_STANDARD },
    )
    expect(dialog.style.animation).toBe("none")
    expect(dialog.parentElement).toHaveClass("pointer-events-none")
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
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
    // Reversing the entrance starts from its current pose rather than flashing at rest.
    expect(dialog.style.opacity).toBe("0.42")
    expect(dialog.style.transform).toBe(transformAtClose)
    expect(dialog).toHaveAttribute("data-state", "closed")
    expect(motionCalls.start).toHaveBeenLastCalledWith(
      { opacity: 0, scale: 0.55, x: -505, y: -270 },
      { duration: DURATION_UI, ease: EASE_STANDARD },
    )
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
    expect(backdrop.style.animation).toBe("none")
    expect(backdrop).toHaveAttribute("data-state", "closed")
    expect(motionCalls.start).toHaveBeenCalledWith({ opacity: 0 }, TWEEN_FAST)
  })

  it.each([false, true])("uses the task fallback exit without a card (reduced motion: %s)", (reduce) => {
    motionCalls.reduce = reduce
    const onClose = vi.fn()
    const view = render(<Overlay open animateFromOrigin onClose={onClose} title="New category">body</Overlay>)
    view.rerender(<Overlay open={false} animateFromOrigin onClose={onClose} title="New category">body</Overlay>)
    expect(motionCalls.start).toHaveBeenLastCalledWith(
      { opacity: 0, scale: reduce ? 1 : 0.95, x: 0, y: reduce ? 0 : 20 },
      { duration: DURATION_FAST, ease: EASE_STANDARD },
    )
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
