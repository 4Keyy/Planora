import { render, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PresenceRow, usePresenceArrivals, type PresenceMember } from "@/components/ui/presence-row"

/**
 * The arrival ring is the thing under test, and it is the thing jsdom is worst at.
 * So the assertions go at the RULE — which ids count as an arrival, and whether the
 * ring element exists at all — never at an interpolated opacity or a transform
 * matrix, which framer-motion does not drive to completion here.
 */

/**
 * `window.matchMedia` cannot drive this, and the reason is worth knowing.
 *
 * framer-motion reads the preference ONCE per module instance:
 * `initPrefersReducedMotion()` is guarded by a module-level
 * `hasReducedMotionListener` flag and caches the result in `prefersReducedMotion`.
 * So the first test in a file that renders anything calling `useReducedMotion`
 * locks the value for every test after it, and re-stubbing `matchMedia` in a
 * later test changes nothing at all — the test passes alone and fails in the
 * suite, which is the worst failure mode a test can have.
 *
 * Mocking the hook itself is the honest fix: it is the thing the component
 * actually depends on, and one switch drives every test in the file.
 */
const reduceMotion = { current: false }

vi.mock("framer-motion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("framer-motion")>()
  return { ...actual, useReducedMotion: () => reduceMotion.current }
})

function mockMatchMedia(prefersReducedMotion: boolean) {
  reduceMotion.current = prefersReducedMotion
  window.matchMedia = vi.fn().mockReturnValue({
    matches: prefersReducedMotion,
    media: "",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }) as unknown as typeof window.matchMedia
}

beforeEach(() => {
  mockMatchMedia(false)
})

afterEach(() => {
  vi.restoreAllMocks()
})

const ada: PresenceMember = { id: "a", name: "Ada Lovelace" }
const alan: PresenceMember = { id: "b", name: "Alan Turing" }
const grace: PresenceMember = { id: "c", name: "Grace Hopper" }
const katherine: PresenceMember = { id: "d", name: "Katherine Johnson" }
const mary: PresenceMember = { id: "e", name: "Mary Jackson" }
const dorothy: PresenceMember = { id: "f", name: "Dorothy Vaughan" }

/** Arrival rings are the only SVG this component draws. */
const rings = (container: HTMLElement) => container.querySelectorAll("svg")

// ─── usePresenceArrivals ────────────────────────────────────────────────────

describe("usePresenceArrivals", () => {
  it("treats the first set as the state of the world, not as arrivals", async () => {
    // Otherwise every page load rings everyone at once and the ring stops meaning
    // "somebody just joined".
    const { result } = renderHook(({ ids }) => usePresenceArrivals(ids), {
      initialProps: { ids: ["a", "b"] },
    })
    await waitFor(() => expect(result.current.size).toBe(0))
  })

  it("reports only the ids that were not there before", async () => {
    const { result, rerender } = renderHook(({ ids }) => usePresenceArrivals(ids), {
      initialProps: { ids: ["a"] },
    })
    rerender({ ids: ["a", "b", "c"] })
    await waitFor(() => expect([...result.current].sort()).toEqual(["b", "c"]))
  })

  it("holds the arrival across re-renders that did not change the set", async () => {
    // The parent re-renders for reasons of its own; recomputing "nobody is new" on
    // those renders would cut the ring off mid-draw.
    const { result, rerender } = renderHook(({ ids }) => usePresenceArrivals(ids), {
      initialProps: { ids: ["a"] },
    })
    rerender({ ids: ["a", "b"] })
    await waitFor(() => expect([...result.current]).toEqual(["b"]))

    rerender({ ids: ["b", "a"] })
    rerender({ ids: ["a", "b"] })
    await waitFor(() => expect([...result.current]).toEqual(["b"]))
  })

  it("clears the arrival once somebody actually leaves", async () => {
    const { result, rerender } = renderHook(({ ids }) => usePresenceArrivals(ids), {
      initialProps: { ids: ["a"] },
    })
    rerender({ ids: ["a", "b"] })
    await waitFor(() => expect(result.current.size).toBe(1))

    rerender({ ids: ["a"] })
    await waitFor(() => expect(result.current.size).toBe(0))
  })

  it("counts a returning id as a fresh arrival", async () => {
    const { result, rerender } = renderHook(({ ids }) => usePresenceArrivals(ids), {
      initialProps: { ids: ["a", "b"] },
    })
    rerender({ ids: ["a"] })
    rerender({ ids: ["a", "b"] })
    await waitFor(() => expect([...result.current]).toEqual(["b"]))
  })
})

// ─── PresenceRow ────────────────────────────────────────────────────────────

describe("PresenceRow", () => {
  it("renders nothing at all when nobody is in the task", () => {
    // A solo task must carry no chrome; an empty stack is a permanent reminder of
    // collaboration on every private task a person owns.
    const { container } = render(<PresenceRow members={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("states the whole fact in one sr-only sentence", () => {
    const { container } = render(<PresenceRow members={[ada, alan, grace]} required={5} />)
    expect(container.querySelector(".sr-only")).toHaveTextContent(
      "Ada Lovelace and 2 others are working on this. 3 of 5 needed.",
    )
    // NumberRoll publishes an `sr-only` value of its own, so counting `.sr-only`
    // NODES measures the wrong thing — what has to be true is that only one of
    // them is reachable. Every other one sits inside an `aria-hidden` subtree,
    // which removes it from the accessibility tree entirely.
    const reachable = [...container.querySelectorAll(".sr-only")].filter(
      (node) => node.closest('[aria-hidden="true"]') === null,
    )
    expect(reachable).toHaveLength(1)
  })

  it("names both people when there are exactly two", () => {
    const { container } = render(<PresenceRow members={[ada, alan]} />)
    expect(container.querySelector(".sr-only")).toHaveTextContent(
      "Ada Lovelace and Alan Turing are working on this.",
    )
  })

  it("keeps the verb agreeing with the headcount", () => {
    const { container } = render(<PresenceRow members={[ada]} />)
    expect(container.querySelector(".sr-only")).toHaveTextContent("Ada Lovelace is working on this.")
  })

  it("survives a member with no name", () => {
    const { container } = render(<PresenceRow members={[{ id: "x", name: null }]} />)
    expect(container.querySelector(".sr-only")).toHaveTextContent("Someone is working on this.")
  })

  it("hides every face from assistive tech, so nobody tabs through a crowd", () => {
    const { container } = render(<PresenceRow members={[ada, alan]} />)
    const stack = container.querySelector('[aria-hidden="true"]')
    expect(stack).not.toBeNull()
    expect(stack?.querySelector(".sr-only")).toBeNull()
  })

  it("says nothing about a fraction that was never asked for", () => {
    const { container } = render(<PresenceRow members={[ada, alan]} />)
    expect(container.querySelector(".sr-only")).not.toHaveTextContent("needed")
    expect(container.textContent).not.toContain(" of ")
  })

  it("treats a required of zero as no requirement at all", () => {
    const { container } = render(<PresenceRow members={[ada]} required={0} />)
    expect(container.querySelector(".sr-only")).not.toHaveTextContent("needed")
  })

  it("announces the fraction once, not twice", () => {
    // NumberRoll publishes its own sr-only value; without aria-hidden on the
    // fraction a screen reader hears the count a second time — "2 of 4 needed"
    // followed by a bare "2".
    const { container } = render(<PresenceRow members={[ada, alan]} required={4} />)
    const rolled = container.querySelectorAll(".sr-only")
    expect(rolled.length).toBeGreaterThan(1)
    const reachable = [...rolled].filter((node) => node.closest('[aria-hidden="true"]') === null)
    expect(reachable).toHaveLength(1)
    expect(reachable[0]).toHaveTextContent("2 of 4 needed")
  })

  it("collapses the tail into a +N chip once collapsing buys space", () => {
    const { container } = render(<PresenceRow members={[ada, alan, grace, katherine, mary, dorothy]} max={4} />)
    expect(container).toHaveTextContent("+2")
  })

  it("does not trade one face for a +1 of the same width", () => {
    // A `+1` chip is exactly as wide as the face it replaces, so collapsing a
    // single overflowing person reclaims no space and costs a human being.
    const { container } = render(<PresenceRow members={[ada, alan, grace, katherine, mary]} max={4} />)
    expect(container).not.toHaveTextContent("+1")
  })

  it("still counts everybody in the sentence when faces are collapsed", () => {
    const { container } = render(
      <PresenceRow members={[ada, alan, grace, katherine, mary, dorothy]} max={2} required={6} />,
    )
    expect(container.querySelector(".sr-only")).toHaveTextContent(
      "Ada Lovelace and 5 others are working on this. 6 of 6 needed.",
    )
  })

  it("does not ring anyone on first mount", async () => {
    const { container } = render(<PresenceRow members={[ada, alan]} />)
    await waitFor(() => expect(rings(container)).toHaveLength(0))
  })

  it("rings exactly the people who just arrived", async () => {
    const { container, rerender } = render(<PresenceRow members={[ada]} />)
    rerender(<PresenceRow members={[ada, alan, grace]} />)
    await waitFor(() => expect(rings(container)).toHaveLength(2))
  })

  it("draws the ring with pathLength rather than a colour flash", async () => {
    const { container, rerender } = render(<PresenceRow members={[ada]} />)
    rerender(<PresenceRow members={[ada, alan]} />)
    await waitFor(() => expect(container.querySelector("circle")).not.toBeNull())
    // Stroke comes from the `accent` token through currentColor, never a literal.
    expect(container.querySelector("circle")).toHaveAttribute("stroke", "currentColor")
    expect(container.querySelector("svg")).toHaveClass("text-accent")
  })

  it("keeps the ring out of the accessibility tree", async () => {
    const { container, rerender } = render(<PresenceRow members={[ada]} />)
    rerender(<PresenceRow members={[ada, alan]} />)
    await waitFor(() => expect(rings(container)).toHaveLength(1))
    expect(rings(container)[0]).toHaveAttribute("aria-hidden", "true")
  })

  it("skips the self-drawing ring under prefers-reduced-motion", async () => {
    // The sentence still carries the arrival; the decorative sweep is exactly what
    // the setting exists to refuse.
    mockMatchMedia(true)
    const { container, rerender } = render(<PresenceRow members={[ada]} />)
    rerender(<PresenceRow members={[ada, alan]} />)
    await waitFor(() => expect(container.querySelector(".sr-only")).toHaveTextContent("Alan Turing"))
    expect(rings(container)).toHaveLength(0)
  })

  it("drops a departed member from the sentence", () => {
    const { container, rerender } = render(<PresenceRow members={[ada, alan]} />)
    rerender(<PresenceRow members={[ada]} />)
    expect(container.querySelector(".sr-only")).toHaveTextContent("Ada Lovelace is working on this.")
  })

  it("scales the stack down without changing what it says", () => {
    const { container } = render(<PresenceRow members={[ada, alan]} size="sm" />)
    expect(container.querySelector(".sr-only")).toHaveTextContent("Ada Lovelace and Alan Turing")
    expect(container.querySelector(".-ml-1\\.5")).not.toBeNull()
  })

  it("merges a caller's classes onto the row", () => {
    const { container } = render(<PresenceRow members={[ada]} className="mt-2" />)
    expect(container.firstElementChild).toHaveClass("mt-2")
  })
})
