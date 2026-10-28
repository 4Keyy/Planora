import { useMemo } from "react"
import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { MotionValue } from "framer-motion"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Overlay } from "@/components/ui/overlay"
import { DURATION_FAST, DURATION_UI, EASE_STANDARD, SPRING_LAYOUT, TWEEN_FAST } from "@/lib/animations"
import { forgetOrigin, rememberOrigin, takeOrigin } from "@/lib/shared-origin"

/**
 * The panel runs one progress value (0 at the card, 1 at rest) through `animate`; the mock records
 * each run, leaves an opening where it starts so its first pose can be read off the panel, and
 * lands an exit at once unless the test holds it.
 */
const motion = vi.hoisted(() => ({
  runs: [] as Array<{ value: MotionValue<number>; from: number; to: number; transition: unknown }>,
  backdropStarts: [] as unknown[][],
  reduce: false,
  holdExits: false,
  exitResolvers: [] as Array<() => void>,
}))

vi.mock("framer-motion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("framer-motion")>()
  return {
    ...actual,
    useReducedMotion: () => motion.reduce,
    useAnimationControls: () => {
      const controls = actual.useAnimationControls()
      return useMemo(() => ({
        ...controls,
        start: (...args: Parameters<typeof controls.start>) => {
          motion.backdropStarts.push(args)
          return controls.start(...args)
        },
      }), [controls])
    },
    animate: (value: MotionValue<number>, to: number, transition: unknown) => {
      motion.runs.push({ value, from: value.get(), to, transition })
      let finish: () => void = () => undefined
      const done = new Promise<void>((resolve) => { finish = resolve })
      if (to === 0) {
        if (motion.holdExits) {
          motion.exitResolvers.push(() => { value.set(0); finish() })
        } else {
          value.set(0)
          finish()
        }
      }
      return { stop: vi.fn(), then: (onDone: () => void) => done.then(onDone) }
    },
  }
})

const opens = () => motion.runs.filter((run) => run.to === 1)
const exits = () => motion.runs.filter((run) => run.to === 0)
const dialog = () => screen.getByRole("dialog")
/** The content layer inside the panel, counter-scaled to its own size. */
const content = () => dialog().firstElementChild as HTMLElement

function recordCard(left = 40, top = 120) {
  const card = document.createElement("button")
  Object.defineProperty(card, "getBoundingClientRect", { value: () => new DOMRect(left, top, 350, 120) })
  rememberOrigin(card)
}

beforeEach(() => {
  vi.clearAllMocks()
  motion.runs = []
  motion.backdropStarts = []
  motion.reduce = false
  motion.holdExits = false
  motion.exitResolvers = []
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
  it("starts as the pressed card's own rectangle and springs to rest", async () => {
    recordCard()
    render(<Overlay open animateFromOrigin onClose={vi.fn()} title="Edit category" className="max-w-3xl">body</Overlay>)

    // Card 350×120 at (40,120), panel 768×500 at (336,200): centre on centre, each axis its own.
    await waitFor(() => expect(dialog().style.transform).toContain("translateX(-505px) translateY(-270px)"))
    expect(dialog().style.transform).toMatch(/scaleX\(0\.4557\d*\) scaleY\(0\.24\)/)
    expect(dialog().style.opacity).toBe("0")
    // The content keeps its natural size inside the shrunken panel, and waits to fade in.
    expect(content().style.transform).toMatch(/scaleX\(2\.194\d*\) scaleY\(4\.166\d*\)/)
    expect(content().style.opacity).toBe("0")

    expect(opens()).toHaveLength(1)
    expect(opens()[0].transition).toMatchObject(SPRING_LAYOUT)
    expect(dialog()).toHaveClass("max-w-3xl")
    expect(dialog().style.height).toBe("")
    expect(dialog().style.animation).toBe("none")
    expect(takeOrigin()).toBeNull()
  })

  it("comes to rest with nothing scaled once the spring lands", async () => {
    recordCard()
    render(<Overlay open animateFromOrigin onClose={vi.fn()} title="Edit">body</Overlay>)
    act(() => opens()[0].value.set(1))
    await waitFor(() => expect(dialog().style.opacity).toBe("1"))
    expect(dialog().style.transform).toBe("none")
    expect(content().style.transform).toBe("none")
    expect(content().style.opacity).toBe("1")
  })

  it("rises from just below when no card supplied an origin", async () => {
    render(<Overlay open animateFromOrigin onClose={vi.fn()} title="Edit">body</Overlay>)
    await waitFor(() => expect(dialog().style.transform).toContain("translateY(20px)"))
    expect(dialog().style.transform).toContain("scaleX(0.95) scaleY(0.95)")
    expect(content().style.transform).toBe("none")
    expect(opens()[0].transition).toMatchObject(SPRING_LAYOUT)
  })

  it("consumes the next card on each open edge, including reopening during the exit", async () => {
    motion.holdExits = true
    const onClose = vi.fn()
    const view = render(<Overlay open={false} animateFromOrigin onClose={onClose} title="Edit">body</Overlay>)
    recordCard()
    view.rerender(<Overlay open animateFromOrigin onClose={onClose} title="Edit">body</Overlay>)
    expect(opens()).toHaveLength(1)

    view.rerender(<Overlay open={false} animateFromOrigin onClose={onClose} title="Edit">body</Overlay>)
    recordCard(400, 300)
    view.rerender(<Overlay open animateFromOrigin onClose={onClose} title="Edit">body</Overlay>)

    await waitFor(() => expect(dialog().style.transform).toContain("translateX(-145px) translateY(-90px)"))
    expect(opens()).toHaveLength(2)
    expect(exits()).toHaveLength(1)
    expect(takeOrigin()).toBeNull()
  })

  it("measures the untransformed panel when reopening before motion has flushed the previous frame", async () => {
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
    // Motion values change at once, but their DOM write can wait until the next frame.
    dialog().style.transform = "translate(-150px, -100px) scale(0.6)"
    recordCard(400, 300)
    view.rerender(<Overlay open animateFromOrigin onClose={onClose} title="Edit">body</Overlay>)

    await waitFor(() => expect(dialog().style.transform).toContain("translateX(-145px) translateY(-90px)"))
  })

  it("keeps its origin when content rerenders during autosave", () => {
    recordCard()
    const onClose = vi.fn()
    const view = render(<Overlay open animateFromOrigin onClose={onClose} title="Edit">old content</Overlay>)
    view.rerender(<Overlay open animateFromOrigin onClose={onClose} title="Edit">saved content</Overlay>)
    expect(opens()).toHaveLength(1)
    expect(screen.getByText("saved content")).toBeInTheDocument()
  })

  it.each([false, true])("ignores an old exit completion after reopening and closing again (origin: %s)", async (animateFromOrigin) => {
    motion.holdExits = true
    recordCard()
    const onClose = vi.fn()
    const view = render(<Overlay open animateFromOrigin={animateFromOrigin} onClose={onClose} title="Edit">body</Overlay>)
    view.rerender(<Overlay open={false} animateFromOrigin={animateFromOrigin} onClose={onClose} title="Edit">body</Overlay>)
    const finishOldDialogExit = motion.exitResolvers.at(-1)!
    recordCard(400, 300)
    view.rerender(<Overlay open animateFromOrigin={animateFromOrigin} onClose={onClose} title="Edit">body</Overlay>)
    view.rerender(<Overlay open={false} animateFromOrigin={animateFromOrigin} onClose={onClose} title="Edit">body</Overlay>)
    const finishCurrentDialogExit = motion.exitResolvers.at(-1)!

    await act(async () => finishOldDialogExit())
    expect(dialog()).toHaveAttribute("data-state", "closed")
    await act(async () => finishCurrentDialogExit())
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("gives ordinary overlays the centred rise without consuming a shared card origin", async () => {
    recordCard()
    render(<Overlay open onClose={vi.fn()} title="Other dialog">body</Overlay>)
    await waitFor(() => expect(dialog().style.transform).toContain("translateY(20px)"))
    expect(opens()[0].transition).toMatchObject(SPRING_LAYOUT)
    expect(dialog().style.animation).toBe("none")
    expect(takeOrigin()).toEqual({ left: 40, top: 120, width: 350, height: 120 })
  })

  it("consumes the card but only fades under reduced motion", async () => {
    motion.reduce = true
    recordCard()
    render(<Overlay open animateFromOrigin onClose={vi.fn()} title="Edit">body</Overlay>)
    expect(opens()[0].transition).toEqual(TWEEN_FAST)
    await waitFor(() => expect(dialog().style.transform).toBe("none"))
    expect(dialog().style.opacity).toBe("0")
    expect(takeOrigin()).toBeNull()
  })

  it("folds back into the pressed card on close and unmounts when it lands", async () => {
    recordCard()
    const onClose = vi.fn()
    const view = render(<Overlay open animateFromOrigin onClose={onClose} title="Edit">body</Overlay>)
    act(() => opens()[0].value.set(1))
    motion.holdExits = true
    view.rerender(<Overlay open={false} animateFromOrigin onClose={onClose} title="Edit">body</Overlay>)

    expect(exits()).toHaveLength(1)
    expect(exits()[0]).toMatchObject({ from: 1, to: 0, transition: { duration: DURATION_UI, ease: EASE_STANDARD } })
    // The same run of the same value, backwards: it lands on the card's rectangle.
    expect(exits()[0].value).toBe(opens()[0].value)
    expect(dialog()).toHaveAttribute("data-state", "closed")
    expect(dialog().style.animation).toBe("none")
    expect(dialog().parentElement).toHaveClass("pointer-events-none")

    await act(async () => motion.exitResolvers.at(-1)!())
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

  it("turns round from its current pose when closed during the entrance", async () => {
    recordCard()
    const onClose = vi.fn()
    const view = render(<Overlay open animateFromOrigin onClose={onClose} title="Edit">body</Overlay>)
    act(() => opens()[0].value.set(0.6))
    await waitFor(() => expect(dialog().style.opacity).toBe("1"))
    const transformAtClose = dialog().style.transform
    expect(transformAtClose).toMatch(/scaleX\(0\.78\d*\)/)

    motion.holdExits = true
    view.rerender(<Overlay open={false} animateFromOrigin onClose={onClose} title="Edit">body</Overlay>)
    // Reversing starts where the entrance was rather than flashing at rest or at the card.
    expect(exits()[0]).toMatchObject({ from: 0.6, to: 0 })
    expect(dialog().style.transform).toBe(transformAtClose)
    expect(dialog()).toHaveAttribute("data-state", "closed")
  })

  it.each([false, true])("opens its backdrop with the task editor's TWEEN_FAST (reduced motion: %s)", (reduce) => {
    motion.reduce = reduce
    recordCard()
    const onClose = vi.fn()
    const view = render(<Overlay open animateFromOrigin onClose={onClose} title="Edit">body</Overlay>)
    const backdrop = document.querySelector<HTMLElement>(".backdrop-surface")!
    expect(motion.backdropStarts).toContainEqual([{ opacity: 1 }, TWEEN_FAST])
    expect(backdrop.style.animation).toBe("none")
    expect(backdrop).toHaveAttribute("data-state", "open")
    expect(backdrop).toHaveAttribute("aria-hidden", "true")
    view.rerender(<Overlay open={false} animateFromOrigin onClose={onClose} title="Edit">body</Overlay>)
    expect(backdrop.style.animation).toBe("none")
    expect(backdrop).toHaveAttribute("data-state", "closed")
    expect(motion.backdropStarts).toContainEqual([{ opacity: 0 }, TWEEN_FAST])
  })

  it.each([false, true])("uses the short exit without a card (reduced motion: %s)", (reduce) => {
    motion.reduce = reduce
    const onClose = vi.fn()
    const view = render(<Overlay open animateFromOrigin onClose={onClose} title="New category">body</Overlay>)
    view.rerender(<Overlay open={false} animateFromOrigin onClose={onClose} title="New category">body</Overlay>)
    expect(exits()[0]).toMatchObject({ to: 0, transition: { duration: DURATION_FAST, ease: EASE_STANDARD } })
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
