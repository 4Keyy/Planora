import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AudienceConsole } from "@/app/_landing/audience-console"
import { SharingCeiling } from "@/app/_landing/sharing-ceiling"

/**
 * The landing page's interactive blocks, driven the way a visitor drives them.
 *
 * Their data lives in `src/lib/landing-*` and is tested there; these tests hold the wiring
 * the visitor sees: the hero's seats are pressable, and public is reachable in the ring
 * legend.
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

