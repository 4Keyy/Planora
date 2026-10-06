import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useExitPresence } from "@/hooks/use-exit-presence"

function Surface({ open, exitMs }: { open: boolean; exitMs?: number }) {
  const { mounted, presenceProps } = useExitPresence(open, exitMs)
  if (!mounted) return null
  return (
    <div data-testid="surface" {...presenceProps}>
      <span data-testid="row">row</span>
    </div>
  )
}

afterEach(() => {
  vi.useRealTimers()
})

/**
 * jsdom has no `AnimationEvent`, so React listens for the prefixed `webkitAnimationEnd`
 * there instead of `animationend`. Fire both: the test then means the same thing here and
 * in a browser, where only the unprefixed one is heard.
 */
function endAnimation(el: Element) {
  fireEvent.animationEnd(el)
  fireEvent(el, new Event("webkitAnimationEnd", { bubbles: true }))
}

describe("useExitPresence", () => {
  it("accepts a controlled animation's completion without unmounting a reopened surface", () => {
    let completeExit = () => {}
    function ControlledSurface({ open }: { open: boolean }) {
      const presence = useExitPresence(open, 220)
      completeExit = presence.finishExit
      return presence.mounted ? <div data-testid="controlled" {...presence.presenceProps} /> : null
    }
    const view = render(<ControlledSurface open />)
    view.rerender(<ControlledSurface open={false} />)
    view.rerender(<ControlledSurface open />)
    act(() => completeExit())
    expect(screen.getByTestId("controlled")).toHaveAttribute("data-state", "open")

    view.rerender(<ControlledSurface open={false} />)
    act(() => completeExit())
    expect(screen.queryByTestId("controlled")).toBeNull()
  })

  it("renders nothing until it is opened, then the surface in its open state", () => {
    const { rerender } = render(<Surface open={false} />)
    expect(screen.queryByTestId("surface")).toBeNull()

    rerender(<Surface open />)
    expect(screen.getByTestId("surface")).toHaveAttribute("data-state", "open")
  })

  it("keeps the surface through its fold-away and removes it when the fold ends", () => {
    const { rerender } = render(<Surface open />)
    rerender(<Surface open={false} />)

    // Still there, now running its exit: CSS needs the node to animate it.
    const surface = screen.getByTestId("surface")
    expect(surface).toHaveAttribute("data-state", "closed")

    endAnimation(surface)
    expect(screen.queryByTestId("surface")).toBeNull()
  })

  it("ignores a row's animation ending: only the surface's own exit unmounts it", () => {
    const { rerender } = render(<Surface open />)
    rerender(<Surface open={false} />)

    // animationend bubbles; a cascading row finishing must not cut the fold short.
    endAnimation(screen.getByTestId("row"))
    expect(screen.getByTestId("surface")).toBeInTheDocument()
  })

  it("does not unmount on the entrance ending", () => {
    render(<Surface open />)
    endAnimation(screen.getByTestId("surface"))
    expect(screen.getByTestId("surface")).toHaveAttribute("data-state", "open")
  })

  it("removes the surface on its own when no exit animation runs at all", () => {
    // jsdom, `display: none`, an interrupted animation: no `animationend` will ever come,
    // and an invisible surface must not be left behind catching clicks.
    vi.useFakeTimers()
    const { rerender } = render(<Surface open />)
    rerender(<Surface open={false} />)
    expect(screen.getByTestId("surface")).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(screen.queryByTestId("surface")).toBeNull()
  })

  it.each([160, 220])("keeps a stalled controlled exit for its %ims duration and fallback margin", (exitMs) => {
    vi.useFakeTimers()
    const view = render(<Surface open exitMs={exitMs} />)
    view.rerender(<Surface open={false} exitMs={exitMs} />)
    act(() => vi.advanceTimersByTime(exitMs + 99))
    expect(screen.getByTestId("surface")).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(1))
    expect(screen.queryByTestId("surface")).toBeNull()
  })

  it("reopened mid-fold, it stays mounted and open, and the fallback never fires", () => {
    vi.useFakeTimers()
    const { rerender } = render(<Surface open />)
    rerender(<Surface open={false} />)
    rerender(<Surface open />)

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.getByTestId("surface")).toHaveAttribute("data-state", "open")
  })
})
