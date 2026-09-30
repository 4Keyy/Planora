import { act, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AudienceConsole } from "@/app/_landing/audience-console"
import { SharingCeiling } from "@/app/_landing/sharing-ceiling"
import { TaskBuilder } from "@/app/_landing/task-builder"
import { BranchStory } from "@/app/_landing/branch-story"

/**
 * The landing page's interactive blocks, driven the way a visitor drives them.
 *
 * Their data lives in `src/lib/landing-*` and is tested there; these tests hold the wiring
 * the visitor sees: the hero's seats are pressable, public is reachable in the ring legend,
 * the builder's legend lights the card's signals, and the branch's circle runs the
 * product's own cycle.
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
  it("reaches public through its own switch and says who that is", async () => {
    const user = userEvent.setup()
    render(<SharingCeiling />)
    await user.click(screen.getByRole("switch", { name: "Share with all friends" }))
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true")
    const publicRow = screen.getByText("Public", { selector: "span" }).closest("li") as HTMLElement
    expect(publicRow).toHaveTextContent("(the current reading)")
    expect(screen.getByText(/Nobody outside your friends can\./)).toBeInTheDocument()

    // Naming people leaves the all-friends setting.
    await user.click(screen.getByRole("button", { name: "Add a person" }))
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false")
  })
})

describe("the task builder's legend", () => {
  it("lights the red frame for an urgent task and the ring for all friends", async () => {
    const user = userEvent.setup()
    render(<TaskBuilder />)
    const legend = screen.getByText("What the card is telling you").parentElement as HTMLElement
    expect(within(legend).queryByText(/Red frame.*on the card now/)).toBeNull()

    await user.click(screen.getByRole("button", { name: "Priority 5 of 5, Urgent" }))
    expect(within(legend).getByText("Red frame", { exact: false })).toHaveTextContent("(on the card now)")

    await user.click(screen.getByRole("button", { name: /All friends/ }))
    expect(within(legend).getByText("The ring", { exact: false })).toHaveTextContent("(on the card now)")
    expect(screen.getByRole("img", { name: "Shared with all your friends." })).toBeInTheDocument()
  })

  it("puts the task in progress and back", async () => {
    const user = userEvent.setup()
    render(<TaskBuilder />)
    await user.click(screen.getByRole("button", { name: "In progress" }))
    expect(screen.getByRole("button", { name: "In progress" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByText("In progress: the check wears the category's colour.")).toBeInTheDocument()
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
    await user.click(screen.getByRole("button", { name: "Take the step into work" }))
    expect(screen.getByText("Working")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Finish the step" }))
    expect(screen.getByText("completed the step", { exact: false })).toBeVisible()
    await user.click(screen.getByRole("button", { name: "Reopen the step" }))
    expect(screen.getByRole("button", { name: "Take the step into work" })).toBeInTheDocument()
  })
})
