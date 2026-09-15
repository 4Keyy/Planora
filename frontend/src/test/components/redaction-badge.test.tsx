import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { RedactionBadge, redactionArc } from "@/components/ui/redaction-badge"

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

// ─── redactionArc ───────────────────────────────────────────────────────────

describe("redactionArc", () => {
  it("draws the whole circle for public", () => {
    expect(redactionArc("public")).toEqual({ dash: 1, gap: 0 })
  })

  it("leaves exactly one narrow gap for private", () => {
    const { dash, gap } = redactionArc("private")
    expect(gap).toBeGreaterThan(0)
    // Narrow enough to read as sealed; anything past a quarter reads as shared.
    expect(gap).toBeLessThan(0.25)
    expect(dash).toBeGreaterThan(gap)
  })

  it("keeps the two arcs a complete circle for every audience", () => {
    // The `line` track is drawn full-circle underneath, so a dash and gap that did
    // not sum to 1 would show as a sliver of track the ink never covers.
    for (const arc of [
      redactionArc("public"),
      redactionArc("private"),
      redactionArc("shared"),
      redactionArc("shared", 4),
      redactionArc("shared", 99),
    ]) {
      expect(arc.dash + arc.gap).toBeCloseTo(1, 10)
    }
  })

  it("narrows the ring as viewers are added", () => {
    // This is the whole point of the mark: the shape has to move in one direction as
    // the audience grows, or it is decoration.
    const counts = [0, 1, 2, 3, 5, 7]
    const dashes = counts.map((n) => redactionArc("shared", n).dash)
    for (let i = 1; i < dashes.length; i++) {
      expect(dashes[i]).toBeLessThan(dashes[i - 1])
    }
  })

  it("cuts a shared ring open even before anyone is counted", () => {
    // "Shared with nobody yet" is still not private, and must not draw as private.
    expect(redactionArc("shared").gap).toBeGreaterThan(redactionArc("private").gap)
  })

  it("saturates the cut so the ring never disappears", () => {
    // Past half the circumference the mark stops reading as a ring.
    const huge = redactionArc("shared", 5000)
    expect(huge.gap).toBeLessThanOrEqual(0.5)
    expect(huge.gap).toEqual(redactionArc("shared", 40).gap)
    expect(huge.dash).toBeGreaterThanOrEqual(0.5)
  })

  it("refuses to draw an inside-out ring from a bad count", () => {
    // A negative or NaN count is a caller bug; it should not become a rendering bug.
    for (const bad of [-3, Number.NaN, Number.POSITIVE_INFINITY]) {
      const arc = redactionArc("shared", bad)
      expect(arc.gap).toBeGreaterThanOrEqual(0)
      expect(arc.gap).toBeLessThanOrEqual(0.5)
      expect(arc.dash + arc.gap).toBeCloseTo(1, 10)
    }
    expect(redactionArc("shared", -3)).toEqual(redactionArc("shared", 0))
  })

  it("ignores a viewer count on an audience that has no viewers to count", () => {
    expect(redactionArc("private", 12)).toEqual(redactionArc("private"))
    expect(redactionArc("public", 12)).toEqual(redactionArc("public"))
  })
})

// ─── RedactionBadge ─────────────────────────────────────────────────────────

describe("RedactionBadge", () => {
  it("states the audience once, as a sentence", () => {
    render(<RedactionBadge audience="private" />)
    expect(screen.getByRole("img")).toHaveAccessibleName("Private. Only you can see this.")
  })

  it("counts the audience in the accessible name, with the right noun", () => {
    const { rerender } = render(<RedactionBadge audience="shared" viewerCount={1} />)
    expect(screen.getByRole("img")).toHaveAccessibleName("Shared with 1 person.")
    rerender(<RedactionBadge audience="shared" viewerCount={4} />)
    expect(screen.getByRole("img")).toHaveAccessibleName("Shared with 4 people.")
  })

  it("says so plainly when the count is unknown", () => {
    render(<RedactionBadge audience="shared" />)
    expect(screen.getByRole("img")).toHaveAccessibleName("Shared. Some people can see this.")
  })

  it("hides the mark from assistive tech so the fact is heard once", () => {
    // The ring redraws on every audience change and NumberRoll keeps its own sr-only
    // value. Announced separately, a screen-reader user hears the audience, then a
    // bare digit with no noun attached to it.
    const { container } = render(<RedactionBadge audience="shared" viewerCount={3} />)
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true")
    expect(screen.getByRole("img")).toHaveAccessibleName("Shared with 3 people.")
  })

  it("is not a button when there is nothing to change", () => {
    render(<RedactionBadge audience="public" />)
    expect(screen.queryByRole("button")).toBeNull()
    expect(screen.getByText("Public")).toBeInTheDocument()
  })

  it("becomes a real button when it can cycle the audience", async () => {
    const onClick = vi.fn()
    render(<RedactionBadge audience="private" onClick={onClick} />)
    const button = screen.getByRole("button")
    expect(button).toHaveAttribute("type", "button")
    await userEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it("names the current state AND what pressing does", () => {
    // "Private" alone tells a screen-reader user the state and hides the fact that the
    // badge is the control that changes it.
    render(<RedactionBadge audience="shared" viewerCount={2} onClick={vi.fn()} />)
    expect(screen.getByRole("button")).toHaveAccessibleName(
      "Shared with 2 people. Change who can see it."
    )
  })

  it("gives the pressable badge a full touch target", () => {
    render(<RedactionBadge audience="public" onClick={vi.fn()} />)
    expect(screen.getByRole("button").className).toContain("min-h-touch")
  })

  it("never removes the focus indicator", () => {
    // `focus:outline-none` compiles to a transparent 2px outline in Tailwind, which
    // overrides the global :focus-visible rule and silently deletes the ring.
    render(<RedactionBadge audience="public" onClick={vi.fn()} />)
    expect(screen.getByRole("button").className).not.toContain("outline-none")
  })

  it("rolls the count only when there is a count to roll", () => {
    // `getAllByText`, not `getByText`: NumberRoll renders the digit twice by
    // design — once in the animated column and once in its own `sr-only` node,
    // so the value is spoken instead of every intermediate frame of the roll.
    const { rerender } = render(<RedactionBadge audience="shared" viewerCount={7} />)
    expect(screen.getAllByText("7").length).toBeGreaterThan(0)

    rerender(<RedactionBadge audience="shared" />)
    expect(screen.queryAllByText("7")).toHaveLength(0)

    // A count on private is meaningless — you are the only viewer by definition.
    rerender(<RedactionBadge audience="private" viewerCount={7} />)
    expect(screen.queryAllByText("7")).toHaveLength(0)
  })

  it("marks you at the centre only while you are the only viewer", () => {
    // The filled centre is what separates private from public at 14px, where the two
    // rings differ by about two pixels of gap.
    const { container, rerender } = render(<RedactionBadge audience="private" size="sm" />)
    expect(container.querySelector(".fill-ink")).not.toBeNull()

    rerender(<RedactionBadge audience="public" size="sm" />)
    expect(container.querySelector(".fill-ink")).toBeNull()
  })

  it("draws the ring in ink on a line track, never in a hue", () => {
    // The product spends its one saturated colour on `alert`. A privacy scale painted
    // green/amber/red would compete with overdue and collapse under dichromacy.
    const { container } = render(<RedactionBadge audience="shared" viewerCount={3} />)
    const markup = container.innerHTML
    expect(container.querySelector(".stroke-ink")).not.toBeNull()
    expect(container.querySelector(".stroke-line")).not.toBeNull()
    expect(markup).not.toMatch(/accent|alert|positive|warn/)
  })

  it("normalises the dash pattern so the arc is a fraction, not a pixel length", () => {
    // framer-motion writes `pathLength="1"`, which is what lets redactionArc speak in
    // fractions and keeps the geometry independent of the rendered size.
    const { container } = render(<RedactionBadge audience="shared" viewerCount={3} />)
    const arc = container.querySelectorAll("circle")[1]
    expect(arc).toHaveAttribute("pathLength", "1")
  })

  it("shrinks the mark at the small size without changing its geometry", () => {
    const small = render(<RedactionBadge audience="public" size="sm" />)
    const smallPx = small.container.querySelector("svg")?.getAttribute("width")
    small.unmount()

    const medium = render(<RedactionBadge audience="public" />)
    const mediumPx = medium.container.querySelector("svg")?.getAttribute("width")

    expect(Number(smallPx)).toBeLessThan(Number(mediumPx))
  })
})

describe("RedactionBadge — mark only", () => {
  it("draws the arc and nothing else when the caller prints the word", () => {
    render(<RedactionBadge audience="shared" viewerCount={3} showLabel={false} />)
    expect(screen.queryByText("Shared")).toBeNull()
    expect(screen.queryAllByText("3")).toHaveLength(0)
  })

  it("contributes no accessible name inside a control that already has one", () => {
    // The editor's visibility token is a button whose own text says "shared · 3".
    // A role="img" nested in it would have a screen reader read the fact twice, in
    // two grammars.
    const { container } = render(
      <button type="button">
        <RedactionBadge audience="shared" viewerCount={3} showLabel={false} />
        shared · 3
      </button>,
    )
    expect(screen.queryByRole("img")).toBeNull()
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull()
    expect(screen.getByRole("button")).toHaveAccessibleName("shared · 3")
  })

  it("still names itself when it carries the word", () => {
    render(<RedactionBadge audience="private" />)
    expect(screen.getByRole("img", { name: /Private\. Only you/ })).toBeInTheDocument()
  })

  it("keeps its own name when it is the control", () => {
    // A pressable badge names the state AND what pressing does, so a screen-reader
    // user learns it is a control rather than a status.
    render(<RedactionBadge audience="private" showLabel={false} onClick={() => {}} />)
    expect(
      screen.getByRole("button", { name: /Private\. Only you can see this\. Change who can see it\./ }),
    ).toBeInTheDocument()
  })
})
