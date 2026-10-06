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
    expect(container.querySelectorAll("[data-digit]")).toHaveLength(3)
  })

  it("grows a column when the number gains a digit", () => {
    const { container, rerender } = render(<NumberRoll value={9} />)
    expect(container.querySelectorAll("[data-digit]")).toHaveLength(1)
    rerender(<NumberRoll value={10} />)
    expect(container.querySelectorAll("[data-digit]")).toHaveLength(2)
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
    expect(container.querySelectorAll("[data-digit]")).toHaveLength(1)
  })
})

describe("NumberRoll — the digit is never clipped sideways", () => {
  /**
   * The bug: every column was pinned to `1ch` with `overflow: hidden`. `ch` is the
   * advance of the font's default zero, which in Plus Jakarta Sans is proportional —
   * 7.00px at 14px bold against 8.41px for the tabular figure actually drawn — so the
   * right edge of every digit in every counter was shaved off. jsdom has no layout, so
   * the contract is asserted by construction: nothing fixes the column's width, and
   * nothing clips it horizontally.
   */
  it("does not pin a digit column to a width", () => {
    const { container } = render(<NumberRoll value={8} />)
    const column = container.querySelector("[data-digit]") as HTMLElement
    expect(column.style.width).toBe("")
    expect(column).not.toHaveClass("overflow-hidden")
  })

  it("clips the roll vertically only", () => {
    const { container } = render(<NumberRoll value={8} />)
    const column = container.querySelector("[data-digit]") as HTMLElement
    // inset(top/bottom 0, left/right negative): the box's own top and bottom edges, and
    // room for overhang on either side.
    expect(column.className).toContain("[clip-path:inset(0_-0.25em)]")
    // The outgoing digit is lifted out as position: absolute by popLayout; this column
    // has to be its containing block or it would land elsewhere and escape the clip.
    expect(column).toHaveClass("relative")
  })
})

describe("NumberRoll — reserved width", () => {
  /**
   * The bug this exists for: the tasks header wrapped to a second line the moment a
   * count went from one digit to two, and everything below it jumped 54px. A number
   * is allowed to change; the box around it is not.
   *
   * The reservation used to be `minWidth: Nch`, which inherited the clipping bug above:
   * it reserved the width of proportional zeros, short of N real digits. It is now an
   * invisible run of N tabular zeros sharing the digits' grid cell, so the cell takes
   * whichever is wider — measured by the font itself rather than predicted.
   */
  const wrapper = (c: HTMLElement) => c.querySelector('[aria-hidden="true"]') as HTMLElement

  it("reserves room for the digits it does not have yet", () => {
    const { container } = render(<NumberRoll value={7} minDigits={2} />)
    expect(wrapper(container)).toHaveAttribute("data-reserve", "00")
    expect(wrapper(container).className).toContain("before:content-[attr(data-reserve)]")
    expect(wrapper(container)).toHaveClass("before:invisible")
  })

  it("puts the reservation and the digits in the same grid cell", () => {
    // Two cells side by side would ADD the widths. One shared cell takes the larger.
    const { container } = render(<NumberRoll value={7} minDigits={2} />)
    const el = wrapper(container)
    expect(el).toHaveClass("inline-grid")
    expect(el.className).toContain("before:[grid-area:1/1]")
    expect(el.firstElementChild?.className).toContain("[grid-area:1/1]")
    // Right-aligned inside the reservation: where a number sits among numbers.
    expect(el.firstElementChild).toHaveClass("justify-self-end")
  })

  it("keeps the reserved zeros out of the DOM", () => {
    // Generated content is never read aloud and never matches a query; a real node of
    // zeros would be both.
    const { container } = render(<NumberRoll value={7} minDigits={3} />)
    expect(container.textContent).not.toContain("000")
  })

  it("stops reserving once the value outgrows the reservation", () => {
    // A minimum, never a maximum: 100 must not be clipped into two digits.
    const { container } = render(<NumberRoll value={100} minDigits={2} />)
    expect(wrapper(container)).not.toHaveAttribute("data-reserve")
    expect(container.querySelector(".sr-only")).toHaveTextContent("100")
  })

  it("reserves nothing by default", () => {
    const { container } = render(<NumberRoll value={7} />)
    expect(wrapper(container)).not.toHaveAttribute("data-reserve")
    expect(wrapper(container).className).not.toContain("before:content")
  })

  it.each([
    ["start", "justify-self-start"],
    ["center", "justify-self-center"],
    ["end", "justify-self-end"],
  ] as const)("puts the spare room where align=%s says", (align, cls) => {
    // A lone digit right-aligned in a two-digit box read as "_3" wherever the number
    // was not already at a right edge; the caller now chooses where the room goes.
    const { container } = render(<NumberRoll value={7} minDigits={2} align={align} />)
    expect(wrapper(container).firstElementChild).toHaveClass(cls)
  })

  it("does not zero-pad — it only reserves the space", () => {
    // Padding would change the value the user reads; this changes only the box.
    const { container } = render(<NumberRoll value={7} minDigits={3} />)
    expect(container.querySelector(".sr-only")).toHaveTextContent("7")
    expect(container.textContent).not.toContain("007")
  })
})
