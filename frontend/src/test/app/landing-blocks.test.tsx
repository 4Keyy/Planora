import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AudienceConsole } from "@/app/_landing/audience-console"
import { SharingCeiling } from "@/app/_landing/sharing-ceiling"
import { CardMoves } from "@/app/_landing/card-moves"
import { BranchStory } from "@/app/_landing/branch-story"

/**
 * The landing page's interactive blocks, driven the way a visitor drives them.
 *
 * Their data lives in `src/lib/landing-*` and is tested there; these tests hold the wiring
 * the visitor sees: the hero's seats are pressable, the ring is driven by a row of seats and
 * never closes, the five moves turn the card's real signals on, and the branch's circle
 * runs the product's own cycle.
 */

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

/** Every observed element is on screen at once, so first-sight effects run in the test. */
class IntersectionObserverStub {
  constructor(private readonly callback: IntersectionObserverCallback) {}
  observe(target: Element) {
    this.callback(
      [{ isIntersecting: true, intersectionRatio: 1, target } as unknown as IntersectionObserverEntry],
      this as unknown as IntersectionObserver
    )
  }
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return []
  }
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub)
  vi.stubGlobal("IntersectionObserver", IntersectionObserverStub)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("the hero's circle", () => {
  it("lets a person in from their seat, not only from the chips", async () => {
    const user = userEvent.setup()
    const { container } = render(<AudienceConsole />)
    // The seats are pointer targets inside the aria-hidden picture; the first is Victoria.
    const seat = container.querySelector<HTMLButtonElement>('[aria-hidden="true"] button')
    expect(seat).not.toBeNull()
    expect(seat).toHaveAttribute("tabindex", "-1")
    await user.click(seat as HTMLButtonElement)
    expect(screen.getByRole("button", { name: "Share with Victoria" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByText("You and Victoria can see this.")).toBeInTheDocument()

    await user.click(seat as HTMLButtonElement)
    expect(screen.getByRole("button", { name: "Share with Victoria" })).toHaveAttribute("aria-pressed", "false")
  })

  it("keeps both of two presses made inside one frame", () => {
    const { container } = render(<AudienceConsole />)
    const seats = container.querySelectorAll<HTMLButtonElement>('[aria-hidden="true"] button')
    act(() => {
      seats[0].click()
      seats[2].click()
    })
    expect(screen.getByText("You, Victoria and Mira can see this. So much for the surprise.")).toBeInTheDocument()
  })
})

describe("reading the ring", () => {
  it("is driven by a row of seats: a real slider, stepped from the keyboard", async () => {
    const user = userEvent.setup()
    render(<SharingCeiling />)
    const rail = screen.getByRole("slider", { name: "People who can see it" })
    expect(rail).toHaveAttribute("aria-valuemin", "0")
    expect(rail).toHaveAttribute("aria-valuemax", "10")

    rail.focus()
    await user.keyboard("{End}")
    expect(rail).toHaveAttribute("aria-valuenow", "10")
    expect(rail).toHaveAttribute("aria-valuetext", "10 people")
    expect(screen.getByText("10 people can open it. The ring stopped widening at eight.")).toBeInTheDocument()

    await user.keyboard("{Home}")
    expect(rail).toHaveAttribute("aria-valuetext", "Only you")
    await user.keyboard("{ArrowRight}{ArrowRight}")
    expect(rail).toHaveAttribute("aria-valuenow", "2")
  })

  it("never says public, not even to deny it, and promises protection", () => {
    const { container } = render(<SharingCeiling />)
    expect(screen.queryByRole("switch")).toBeNull()
    expect(container).not.toHaveTextContent(/public/i)
    const row = screen.getByText("Protected", { selector: "span" }).closest("li") as HTMLElement
    expect(row).toHaveTextContent("Always")
    expect(row).toHaveTextContent("Nothing in Planora is ever published")
    expect(row).not.toHaveTextContent(/close/i)
  })
})

describe("one card, five moves", () => {
  const card = () => document.querySelector("[data-task-card]") as HTMLElement

  it("frames a shared card in blue, and red outranks it", async () => {
    const user = userEvent.setup()
    render(<CardMoves />)
    const share = screen.getByRole("button", { name: /^Share/ })
    await user.click(share)
    expect(share).toHaveAttribute("aria-pressed", "true")
    expect(card().className).toContain("border-accent")
    expect(screen.getByText(/a blue frame, the ring opens for two/)).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Urgency: Calm. Press for the next one." }))
    expect(screen.getByRole("button", { name: "Urgency: Urgent. Press for the next one." })).toBeInTheDocument()
    expect(card().className).toContain("border-alert")
  })

  it("gives the card its category's colour to glow in", async () => {
    const user = userEvent.setup()
    render(<CardMoves />)
    await user.click(screen.getByRole("button", { name: "Category: None. Press for the next one." }))
    expect(screen.getByRole("button", { name: "Category: Home. Press for the next one." })).toBeInTheDocument()
    expect(card().style.getPropertyValue("--card-glow")).not.toBe("")
  })

  it("finishes the card through its own circle", async () => {
    const user = userEvent.setup()
    render(<CardMoves />)
    await user.click(screen.getByRole("button", { name: "Finish" }))
    // The product's completion runs its short animation before committing. Finish is an
    // action, not a toggle: it has no pressed state, and its name says what it will do next.
    const reopen = await screen.findByRole("button", { name: "Reopen" }, { timeout: 3000 })
    expect(reopen).not.toHaveAttribute("aria-pressed")
    expect(reopen).toHaveAccessibleDescription("Done")
  })

  it("keeps a toggle's name fixed and puts what it is set to in its description", async () => {
    const user = userEvent.setup()
    render(<CardMoves />)
    const share = screen.getByRole("button", { name: "Share" })
    expect(share).toHaveAccessibleDescription("Only you")
    await user.click(share)
    expect(screen.getByRole("button", { name: "Share" })).toHaveAccessibleDescription("Victoria & Tom")
  })

  it("moves focus to what replaced the card when it is deleted, and back to the moves after", async () => {
    const user = userEvent.setup()
    render(<CardMoves />)
    const del = document.querySelector<HTMLElement>('[aria-label^="Delete task"]')
    expect(del).not.toBeNull()
    del?.focus()
    await user.keyboard("{Enter}")
    const another = await screen.findByRole("button", { name: "Make another" })
    expect(another).toHaveFocus()
    await user.click(another)
    expect(screen.getByRole("button", { name: /^Category/ })).toHaveFocus()
  })
})

describe("the branch story", () => {
  it("plays through its chapters once, then stops on the finished step", () => {
    vi.useFakeTimers()
    render(<BranchStory />)
    expect(screen.getByRole("figure")).toHaveAccessibleName(/at step 1/)
    // One chapter per timer: each step schedules the next once it has rendered.
    for (let i = 0; i < 6; i++) {
      act(() => {
        vi.advanceTimersByTime(3_000)
      })
    }
    expect(screen.getByRole("figure")).toHaveAccessibleName(/at step 6/)
    // Queried by attribute: the row's fade-in is framer-motion's frame loop, which fake
    // timers hold still, and a hidden node has no accessible name. The next test presses
    // the same circle for real.
    expect(document.querySelector('button[aria-label="Reopen the step"]')).not.toBeNull()
    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(screen.getByRole("figure")).toHaveAccessibleName(/at step 6/)
  })

  it("runs the step's circle through the product's cycle", async () => {
    const user = userEvent.setup()
    render(<BranchStory />)
    // Pressing a chapter hands the story over to the reader.
    await user.click(screen.getByRole("button", { name: /A step forks off/ }))
    // Rows become accessible on framer-motion's next frame, after the chapter commits.
    await user.click(await screen.findByRole("button", { name: "Take the step into work" }))
    expect(screen.getByText("Working")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Finish the step" }))
    await waitFor(() => expect(screen.getByText("completed the step", { exact: false })).toBeVisible())
    await user.click(screen.getByRole("button", { name: "Reopen the step" }))
    expect(await screen.findByRole("button", { name: "Take the step into work" })).toBeInTheDocument()
  })
})
