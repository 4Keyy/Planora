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

describe("NumberRoll — reserved width", () => {
  /**
   * The bug this exists for: the tasks header wrapped to a second line the moment a
   * count went from one digit to two, and everything below it jumped 54px. A number
   * is allowed to change; the box around it is not.
   */
  it("reserves room for the digits it does not have yet", () => {
    const { container } = render(<NumberRoll value={7} minDigits={2} />)
    const columns = container.querySelector('[aria-hidden="true"]') as HTMLElement
    expect(columns.style.minWidth).toBe("2ch")
  })

  it("occupies the same width at one digit as it will at two", () => {
    /**
     * This is the whole contract, and jsdom cannot measure it directly — it has no
     * layout. It can be asserted by construction instead: every column is exactly
     * `1ch` (guaranteed by `tabular-nums`), so `n` columns is `n ch`. At 7 there is
     * one column plus a reservation of `2ch`; at 24 there are two columns and no
     * reservation. Both are two characters wide, which is why the header stops
     * reflowing when the count settles.
     */
    const columns = (c: HTMLElement) => c.querySelector('[aria-hidden="true"]') as HTMLElement
    const width = (c: HTMLElement) => {
      const el = columns(c)
      return el.style.minWidth || `${el.querySelectorAll(":scope > span").length}ch`
    }

    const { container, rerender } = render(<NumberRoll value={7} minDigits={2} />)
    expect(width(container)).toBe("2ch")

    rerender(<NumberRoll value={24} minDigits={2} />)
    expect(width(container)).toBe("2ch")
  })

  it("stops reserving once the value outgrows the reservation", () => {
    // A minimum, never a maximum: 100 must not be clipped into two digits.
    const { container } = render(<NumberRoll value={100} minDigits={2} />)
    const columns = container.querySelector('[aria-hidden="true"]') as HTMLElement
    expect(columns.style.minWidth).toBe("")
    expect(container.querySelector(".sr-only")).toHaveTextContent("100")
  })

  it("reserves nothing by default", () => {
    const { container } = render(<NumberRoll value={7} />)
    expect((container.querySelector('[aria-hidden="true"]') as HTMLElement).style.minWidth).toBe("")
  })

  it("does not zero-pad — it only reserves the space", () => {
    // Padding would change the value the user reads; this changes only the box.
    const { container } = render(<NumberRoll value={7} minDigits={3} />)
    expect(container.querySelector(".sr-only")).toHaveTextContent("7")
    expect(container.textContent).not.toContain("007")
  })
})
