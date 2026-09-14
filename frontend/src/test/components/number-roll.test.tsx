import { render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NumberRoll } from "@/components/ui/number-roll"

const setReducedMotion = (matches: boolean) => {
  window.matchMedia = vi.fn().mockReturnValue({
    matches,
    media: "(prefers-reduced-motion: reduce)",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }) as unknown as typeof window.matchMedia
}

beforeEach(() => setReducedMotion(false))
afterEach(() => vi.restoreAllMocks())

describe("NumberRoll", () => {
  it("exposes the value once to assistive technology", () => {
    // The digit columns are aria-hidden. Without the sr-only value a screen reader
    // would read either nothing, or every intermediate digit of every roll.
    const { container } = render(<NumberRoll value={42} />)
    const srOnly = container.querySelector(".sr-only")
    expect(srOnly).toHaveTextContent("42")
    expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument()
  })

  it("renders one column per digit", () => {
    const { container } = render(<NumberRoll value={107} />)
    const columns = container.querySelectorAll(".overflow-hidden")
    expect(columns).toHaveLength(3)
  })

  it("grows a column when the number gains a digit", () => {
    const { container, rerender } = render(<NumberRoll value={9} />)
    expect(container.querySelectorAll(".overflow-hidden")).toHaveLength(1)
    rerender(<NumberRoll value={10} />)
    expect(container.querySelectorAll(".overflow-hidden")).toHaveLength(2)
  })

  it("uses tabular figures, so a roll cannot change its own width", () => {
    // In a proportional face a 1 is narrower than a 7, and a rolling counter would
    // shove its own label sideways mid-animation.
    const { container } = render(<NumberRoll value={17} />)
    expect(container.firstElementChild).toHaveClass("tabular-nums")
  })

  it("announces only when asked", () => {
    const { container, rerender } = render(<NumberRoll value={3} />)
    expect(container.firstElementChild).not.toHaveAttribute("aria-live")
    rerender(<NumberRoll value={3} announce />)
    expect(container.firstElementChild).toHaveAttribute("aria-live", "polite")
  })

  it("renders the plain digits under reduced motion", () => {
    setReducedMotion(true)
    render(<NumberRoll value={58} />)
    expect(screen.getAllByText("5").length).toBeGreaterThan(0)
    expect(screen.getAllByText("8").length).toBeGreaterThan(0)
  })

  it("handles zero", () => {
    const { container } = render(<NumberRoll value={0} />)
    expect(container.querySelector(".sr-only")).toHaveTextContent("0")
    expect(container.querySelectorAll(".overflow-hidden")).toHaveLength(1)
  })
})
