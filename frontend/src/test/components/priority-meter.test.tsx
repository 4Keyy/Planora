import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { PriorityMeter } from "@/components/ui/priority-meter"

const segments = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>("[role='img'] > span[aria-hidden] > span"))
const ticking = (container: HTMLElement) =>
  segments(container).filter((s) => /animate-meter-t(ick|ock)/.test(s.className))

describe("PriorityMeter", () => {
  it("says its level in its name and fills that many segments", () => {
    const { container, getByRole } = render(<PriorityMeter value={4} />)
    expect(getByRole("img", { name: "Priority 4 of 5 — High" })).toBeInTheDocument()
    expect(segments(container).filter((s) => s.className.includes("bg-ink-subtle"))).toHaveLength(4)
  })

  it("draws its first value still, with no cascade", () => {
    const { container } = render(<PriorityMeter value={3} animate />)
    expect(ticking(container)).toHaveLength(0)
  })

  it("fills the new segments one after another, outward from the old level", () => {
    const { container, rerender } = render(<PriorityMeter value={2} animate />)
    rerender(<PriorityMeter value={5} animate />)

    const moving = ticking(container)
    expect(moving).toHaveLength(3)
    expect(moving.map((s) => s.style.transitionDelay)).toEqual(["0ms", "40ms", "80ms"])
  })

  it("empties from the top down", () => {
    const { container, rerender } = render(<PriorityMeter value={5} animate />)
    rerender(<PriorityMeter value={3} animate />)

    // Segments 4 and 5 empty, the fifth first.
    const [fourth, fifth] = segments(container).slice(3)
    expect(fifth.style.transitionDelay).toBe("0ms")
    expect(fourth.style.transitionDelay).toBe("40ms")
  })

  it("replays the tick on the same node by alternating its animation's name", () => {
    const nameOf = (node: HTMLElement) => node.className.match(/animate-meter-t(?:ick|ock)/)?.[0]
    const { container, rerender } = render(<PriorityMeter value={1} animate pulse={0} />)
    rerender(<PriorityMeter value={2} animate pulse={0} />)
    const second = segments(container)[1]
    const before = nameOf(second)

    rerender(<PriorityMeter value={2} animate pulse={1} />)

    // Not remounted — a remount would drop the colour transition — and renamed, so it replays.
    expect(segments(container)[1]).toBe(second)
    expect(before).toBeDefined()
    expect(nameOf(second)).toBeDefined()
    expect(nameOf(second)).not.toBe(before)
  })

  it("ticks its filled segments for a pulse without changing level", () => {
    const { container, rerender, getByRole } = render(<PriorityMeter value={3} animate pulse={0} />)
    rerender(<PriorityMeter value={3} animate pulse={1} />)

    expect(ticking(container)).toHaveLength(3)
    expect(getByRole("img", { name: "Priority 3 of 5 — Medium" })).toBeInTheDocument()
  })

  it("never cascades without animate", () => {
    const { container, rerender } = render(<PriorityMeter value={1} />)
    rerender(<PriorityMeter value={5} />)
    expect(ticking(container)).toHaveLength(0)
  })
})
