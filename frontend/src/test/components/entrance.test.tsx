import { useState } from "react"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  ArrivalHandled,
  Enter,
  EnterEach,
  EnterInView,
  EntranceGroup,
  EntranceTimeline,
  SkeletonSwap,
  entranceDelay,
  useArrivalHandled,
} from "@/components/animated/entrance"
import { tokens } from "@/lib/design-tokens"

/**
 * The page-entrance timeline. Time is `performance.now()`, pinned here so a delay can be
 * read off the element exactly; the motion itself is CSS (`.enter` in globals.css), which
 * jsdom does not run, so what is checked is what each element is told to do.
 */
let now = 1000
beforeEach(() => {
  now = 1000
  vi.spyOn(performance, "now").mockImplementation(() => now)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

const delayOf = (element: HTMLElement) => element.style.getPropertyValue("--enter-delay")

describe("entranceDelay", () => {
  it("waits for a moment still ahead, plus the stagger of its place", () => {
    const step = tokens.motion.entrance.card.stagger
    expect(entranceDelay(1000, "card", 300, 0, 1000)).toBe(300)
    expect(entranceDelay(1000, "card", 300, 2, 1100)).toBe(200 + 2 * step)
  })

  it("starts a moment already passed at once, keeping only the stagger", () => {
    const step = tokens.motion.entrance.row.stagger
    expect(entranceDelay(1000, "row", 100, 0, 1500)).toBe(0)
    expect(entranceDelay(1000, "row", 100, 3, 1500)).toBe(3 * step)
  })

  it("caps the stagger at eight steps and ignores a negative place", () => {
    const step = tokens.motion.entrance.chip.stagger
    expect(entranceDelay(0, "chip", 0, 30, 0)).toBe(8 * step)
    expect(entranceDelay(0, "chip", 0, -2, 0)).toBe(0)
  })
})

describe("Enter", () => {
  it("does nothing outside a page timeline", () => {
    render(<Enter tier="card" data-testid="card" className="own" />)
    const card = screen.getByTestId("card")
    expect(card).toHaveClass("own")
    expect(card).not.toHaveClass("enter")
    expect(card.getAttribute("style")).toBeNull()
  })

  it("arrives on its moment with its tier's motion, keeping its own class and style", () => {
    render(
      <EntranceTimeline>
        <Enter tier="card" at={240} index={1} data-testid="card" className="own" style={{ color: "red" }} />
      </EntranceTimeline>,
    )
    const card = screen.getByTestId("card")
    const tier = tokens.motion.entrance.card
    expect(card).toHaveClass("enter", "own")
    expect(delayOf(card)).toBe(`${240 + tier.stagger}ms`)
    expect(card.style.getPropertyValue("--enter-y")).toBe(`${tier.y}px`)
    expect(card.style.getPropertyValue("--enter-scale")).toBe(String(tier.scale))
    expect(card.style.getPropertyValue("--enter-duration")).toBe(`${tier.duration}ms`)
    expect(card.style.color).toBe("red")
  })

  it("decides its delay once: a later render does not move it", () => {
    function Harness() {
      const [count, setCount] = useState(0)
      return (
        <EntranceTimeline>
          <Enter tier="row" at={200} data-testid="row">{count}</Enter>
          <button onClick={() => setCount((c) => c + 1)}>again</button>
        </EntranceTimeline>
      )
    }
    render(<Harness />)
    expect(delayOf(screen.getByTestId("row"))).toBe("200ms")
    now += 150
    fireEvent.click(screen.getByRole("button", { name: "again" }))
    expect(screen.getByTestId("row")).toHaveTextContent("1")
    expect(delayOf(screen.getByTestId("row"))).toBe("200ms")
  })

  it("waits invisible until what it shows is ready, then arrives at once if its moment passed", () => {
    function Harness() {
      const [ready, setReady] = useState(false)
      return (
        <EntranceTimeline>
          <Enter tier="text" at={100} ready={ready} data-testid="count" />
          <button onClick={() => setReady(true)}>load</button>
        </EntranceTimeline>
      )
    }
    render(<Harness />)
    const count = screen.getByTestId("count")
    expect(count).toHaveClass("enter-pending")
    expect(count).not.toHaveClass("enter")

    now += 400
    fireEvent.click(screen.getByRole("button", { name: "load" }))
    expect(count).toHaveClass("enter")
    expect(count).not.toHaveClass("enter-pending")
    expect(delayOf(count)).toBe("0ms")
  })

  it("grows a bar out of its baseline instead of raising it", () => {
    render(
      <EntranceTimeline>
        <Enter tier="chip" motion="grow" data-testid="bar" />
      </EntranceTimeline>,
    )
    expect(screen.getByTestId("bar")).toHaveClass("enter-grow")
    expect(screen.getByTestId("bar")).not.toHaveClass("enter")
  })

  it("is shifted by an EntranceGroup", () => {
    render(
      <EntranceTimeline>
        <EntranceGroup at={300}>
          <Enter tier="text" at={60} data-testid="title" />
        </EntranceGroup>
      </EntranceTimeline>,
    )
    expect(delayOf(screen.getByTestId("title"))).toBe("360ms")
  })
})

describe("EnterEach", () => {
  it("tells its children to arrive one after another from when the list appears", () => {
    render(
      <EntranceTimeline>
        <EnterEach as="ul" tier="row" at={120} data-testid="list">
          <li>one</li>
          <li>two</li>
        </EnterEach>
      </EntranceTimeline>,
    )
    const list = screen.getByTestId("list")
    expect(list.tagName).toBe("UL")
    expect(list).toHaveClass("enter-each")
    expect(delayOf(list)).toBe("120ms")
    expect(list.style.getPropertyValue("--enter-stagger")).toBe(`${tokens.motion.entrance.row.stagger}ms`)
  })

  it("times a list that comes late from its own arrival", () => {
    function Harness() {
      const [loaded, setLoaded] = useState(false)
      return (
        <EntranceTimeline>
          {loaded ? (
            <EnterEach tier="row" at={120} data-testid="list"><p>row</p></EnterEach>
          ) : null}
          <button onClick={() => setLoaded(true)}>load</button>
        </EntranceTimeline>
      )
    }
    render(<Harness />)
    now += 900
    fireEvent.click(screen.getByRole("button", { name: "load" }))
    expect(delayOf(screen.getByTestId("list"))).toBe("0ms")
  })
})

describe("EnterInView", () => {
  type Callback = (entries: Array<{ isIntersecting: boolean }>) => void
  let observed: { callback: Callback; disconnect: ReturnType<typeof vi.fn> }[] = []

  beforeEach(() => {
    observed = []
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        disconnect = vi.fn()
        constructor(callback: Callback) {
          observed.push({ callback, disconnect: this.disconnect })
        }
        observe() {}
        unobserve() {}
      },
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  it("keeps what is below the screen waiting until it scrolls into view", () => {
    // jsdom lays nothing out: every box is 0×0 at the top, which reads as off-screen.
    render(
      <EntranceTimeline>
        <EnterInView as="section" tier="panel" data-testid="section">
          <Enter tier="text" at={60} data-testid="heading" />
        </EnterInView>
      </EntranceTimeline>,
    )
    const section = screen.getByTestId("section")
    expect(section.tagName).toBe("SECTION")
    expect(section).toHaveClass("enter-pending")
    expect(screen.getByTestId("heading")).toHaveClass("enter-pending")

    now = 5000
    act(() => observed[0].callback([{ isIntersecting: true }]))
    expect(section).toHaveClass("enter")
    expect(delayOf(section)).toBe("0ms")
    expect(screen.getByTestId("heading")).toHaveClass("enter")
    expect(delayOf(screen.getByTestId("heading"))).toBe("60ms")
    expect(observed[0].disconnect).toHaveBeenCalled()
  })

  it("arrives on the page's timeline when it is on the first screen", () => {
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      top: 100, bottom: 300, left: 0, right: 100, width: 100, height: 200, x: 0, y: 100, toJSON: () => ({}),
    })
    render(
      <EntranceTimeline>
        <EnterInView at={250} tier="panel" index={1} data-testid="card">
          <span />
        </EnterInView>
      </EntranceTimeline>,
    )
    expect(delayOf(screen.getByTestId("card"))).toBe(`${250 + tokens.motion.entrance.panel.stagger}ms`)
    expect(observed).toHaveLength(0)
    rect.mockRestore()
  })

  it("forwards its ref, and renders plainly outside a timeline", () => {
    let node: HTMLElement | null = null
    render(
      <EnterInView tier="panel" ref={(el) => { node = el }} data-testid="plain">
        <span />
      </EnterInView>,
    )
    expect(node).toBe(screen.getByTestId("plain"))
    expect(screen.getByTestId("plain")).not.toHaveClass("enter-pending")
  })
})

describe("SkeletonSwap", () => {
  function Harness({ initial = true }: { initial?: boolean }) {
    const [loading, setLoading] = useState(initial)
    return (
      <>
        <SkeletonSwap loading={loading} skeleton={<p data-testid="skeleton" />}>
          <p data-testid="content" />
        </SkeletonSwap>
        <button onClick={() => setLoading((l) => !l)}>toggle</button>
      </>
    )
  }

  it("defers the skeleton, so a quick load never shows one", () => {
    render(<Harness />)
    expect(screen.getByTestId("skeleton").parentElement).toHaveClass("skeleton-defer")
    expect(screen.queryByTestId("content")).not.toBeInTheDocument()

    now += 120
    fireEvent.click(screen.getByRole("button", { name: "toggle" }))
    expect(screen.queryByTestId("skeleton")).not.toBeInTheDocument()
    expect(screen.getByTestId("content")).toBeInTheDocument()
  })

  it("fades a skeleton that was showing out from under the content", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    render(<Harness />)
    const holder = screen.getByTestId("skeleton").parentElement as HTMLElement

    now += 600
    fireEvent.click(screen.getByRole("button", { name: "toggle" }))
    expect(screen.getByTestId("content")).toBeInTheDocument()
    expect(screen.getByTestId("skeleton").parentElement).toBe(holder)
    expect(holder).toHaveClass("skeleton-leave", "absolute")
    expect(holder).not.toHaveClass("skeleton-defer")

    act(() => vi.advanceTimersByTime(tokens.motion.duration.slow))
    expect(screen.queryByTestId("skeleton")).not.toBeInTheDocument()
  })

  it("shows the content at once when nothing was loading", () => {
    render(<Harness initial={false} />)
    expect(screen.getByTestId("content")).toBeInTheDocument()
    expect(screen.queryByTestId("skeleton")).not.toBeInTheDocument()
  })
})

describe("ArrivalHandled", () => {
  it("tells a component that an ancestor animates its arrival", () => {
    function Probe() {
      return <p>{useArrivalHandled() ? "handled" : "own"}</p>
    }
    const { rerender } = render(<Probe />)
    expect(screen.getByText("own")).toBeInTheDocument()
    rerender(<ArrivalHandled><Probe /></ArrivalHandled>)
    expect(screen.getByText("handled")).toBeInTheDocument()
  })
})
