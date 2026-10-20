import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  holdScroll,
  isScrollHeld,
  primeScrollHold,
  resetScrollHoldForTests,
  trackScrollPosition,
} from "@/lib/scroll-hold"

/**
 * A page the follower can move: `scrollY` is a number it writes through `scrollTo`, the document's
 * content ends where `contentBottom` says (one static child of `body`), and frames are run by hand.
 */
let scrollY = 0
let scrollReads = 0
let contentBottom = 2000
let reduced = false
let frames: Array<FrameRequestCallback> = []
let clock = 0
const VIEW = 800

function runFrame(ms = 16) {
  clock += ms
  const due = frames
  frames = []
  for (const callback of due) callback(clock)
}

function runFrames(count: number, ms = 16) {
  for (let i = 0; i < count; i++) runFrame(ms)
}

let content: HTMLDivElement
const originalScrollY = Object.getOwnPropertyDescriptor(window, "scrollY")

beforeEach(() => {
  scrollY = 0
  scrollReads = 0
  contentBottom = 2000
  reduced = false
  frames = []
  clock = 1000
  Object.defineProperty(window, "scrollY", {
    configurable: true,
    get: () => {
      scrollReads += 1
      return scrollY
    },
  })
  vi.stubGlobal("innerHeight", VIEW)
  vi.stubGlobal("scrollTo", vi.fn((x?: number | ScrollToOptions, y?: number) => {
    scrollY = typeof x === "number" ? (y ?? 0) : (x?.top ?? 0)
  }))
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.push(callback)
    return frames.length
  })
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {
    frames = []
  })
  vi.spyOn(performance, "now").mockImplementation(() => clock)
  vi.stubGlobal("matchMedia", vi.fn().mockImplementation((query: string) => ({
    matches: reduced && query.includes("reduce"),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })))

  content = document.createElement("div")
  content.getBoundingClientRect = () => ({ top: -scrollY, bottom: contentBottom - scrollY, height: contentBottom } as DOMRect)
  document.body.appendChild(content)
  document.documentElement.style.overflowAnchor = ""
  document.documentElement.style.scrollBehavior = ""
  document.body.style.minHeight = ""
})

afterEach(() => {
  resetScrollHoldForTests()
  content.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  if (originalScrollY) Object.defineProperty(window, "scrollY", originalScrollY)
  else Reflect.deleteProperty(window, "scrollY")
})

/** Starts from `y`, as if the reader had scrolled there. */
function scrolledTo(y: number) {
  scrollY = y
  window.dispatchEvent(new Event("scroll"))
}

describe("trackScrollPosition", () => {
  it("listens once however many ask, and stops when the last lets go", () => {
    const add = vi.spyOn(window, "addEventListener")
    const remove = vi.spyOn(window, "removeEventListener")
    const first = trackScrollPosition()
    const second = trackScrollPosition()
    expect(add.mock.calls.filter(([type]) => type === "scroll")).toHaveLength(1)
    first()
    first()
    expect(remove.mock.calls.filter(([type]) => type === "scroll")).toHaveLength(0)
    second()
    expect(remove.mock.calls.filter(([type]) => type === "scroll")).toHaveLength(1)
  })
})

describe("primeScrollHold", () => {
  it("writes the hold from the position it tracked, without asking the page where it is", () => {
    const stop = trackScrollPosition()
    scrolledTo(1200)
    scrollReads = 0
    primeScrollHold()
    expect(scrollReads).toBe(0)
    expect(document.documentElement.style.overflowAnchor).toBe("none")
    expect(document.documentElement.style.scrollBehavior).toBe("auto")
    expect(document.body.style.minHeight).toBe(`${1200 + VIEW}px`)
    expect(isScrollHeld()).toBe(true)
    stop()
  })

  it("lets go on the next frame when nothing asked to keep it, and puts every style back", () => {
    document.documentElement.style.scrollBehavior = "smooth"
    document.body.style.minHeight = "10px"
    scrolledTo(300)
    primeScrollHold()
    runFrame()
    expect(isScrollHeld()).toBe(false)
    expect(document.documentElement.style.overflowAnchor).toBe("")
    expect(document.documentElement.style.scrollBehavior).toBe("smooth")
    expect(document.body.style.minHeight).toBe("10px")
    expect(scrollY).toBe(300)
  })

  it("does nothing under reduced motion", () => {
    reduced = true
    primeScrollHold()
    expect(isScrollHeld()).toBe(false)
    expect(document.body.style.minHeight).toBe("")
  })

  it("is safe to call again while a hold is open", () => {
    scrolledTo(100)
    primeScrollHold()
    document.body.style.minHeight = "999px"
    primeScrollHold()
    expect(document.body.style.minHeight).toBe("999px")
  })
})

describe("holdScroll", () => {
  it("keeps the view still while the page stays long enough, then hands it back", () => {
    scrolledTo(600)
    const release = holdScroll()
    runFrames(30)
    expect(scrollY).toBe(600)
    expect(isScrollHeld()).toBe(true)
    release()
    runFrame()
    expect(isScrollHeld()).toBe(false)
  })

  it("glides to the new bottom of a page that became shorter — from rest, never past it", () => {
    scrolledTo(1200)
    const release = holdScroll()
    contentBottom = 1600 // the bottom the view can reach is now 800
    const path: number[] = []
    for (let i = 0; i < 90; i++) {
      runFrame()
      path.push(scrollY)
    }
    release()
    runFrames(5)
    // It eases out of rest: the first frame moves far less than the 400px it has to go.
    expect(1200 - path[0]).toBeLessThan(40)
    for (let i = 1; i < path.length; i++) expect(path[i]).toBeLessThanOrEqual(path[i - 1] + 1e-9)
    expect(Math.min(...path)).toBeGreaterThanOrEqual(800)
    expect(path.at(-1)).toBeCloseTo(800, 0)
    // The document is held under the view the whole way, so nothing ever clamps it.
    expect(isScrollHeld()).toBe(false)
  })

  it("keeps the top of what it is asked to show in view, below the floating bar", () => {
    const realRect = HTMLElement.prototype.getBoundingClientRect
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.style.height.includes("--bar-clearance")) return { top: 0, bottom: 88, height: 88 } as DOMRect
      return realRect.call(this)
    })
    const card = document.createElement("div")
    card.getBoundingClientRect = () => ({ top: 900 - scrollY, bottom: 946 - scrollY, height: 46 } as DOMRect)
    document.body.appendChild(card)
    scrolledTo(1100)
    const release = holdScroll({ show: () => card })
    runFrames(120)
    // 900 − 88 (the bar) − 12 (air) = 800.
    expect(scrollY).toBeCloseTo(800, 0)
    release()
    runFrame()
    card.remove()
  })

  it("brings the bottom of what it is asked to show up into view, by the nearest edge", () => {
    const button = document.createElement("button")
    button.getBoundingClientRect = () => ({ top: 1500 - scrollY, bottom: 1544 - scrollY, height: 44 } as DOMRect)
    document.body.appendChild(button)
    scrolledTo(600)
    const release = holdScroll({ show: () => button })
    runFrames(120)
    // 1544 − 800 (the view) + 12 (air) = 756.
    expect(scrollY).toBeCloseTo(756, 0)
    release()
    runFrame()
    button.remove()
  })

  it("stays where showing something brought it once that hold closes", () => {
    const button = document.createElement("button")
    button.getBoundingClientRect = () => ({ top: 1500 - scrollY, bottom: 1544 - scrollY, height: 44 } as DOMRect)
    document.body.appendChild(button)
    scrolledTo(600)
    const release = holdScroll({ show: () => button })
    runFrames(120)
    release()
    release()
    runFrames(120)
    expect(scrollY).toBeCloseTo(756, 0)
    expect(isScrollHeld()).toBe(false)
    button.remove()
  })

  it("ignores what it is asked to show once it has left the page", () => {
    const gone = document.createElement("div")
    scrolledTo(500)
    const release = holdScroll({ show: () => gone })
    runFrames(10)
    expect(scrollY).toBe(500)
    release()
  })

  it("glides to where a hold sends it, and stays there after it closes", () => {
    scrolledTo(1100)
    const release = holdScroll({ to: 240 })
    runFrames(40)
    release()
    runFrames(120)
    expect(scrollY).toBeCloseTo(240, 0)
    expect(isScrollHeld()).toBe(false)
  })

  it("hands the page back the moment the reader scrolls", () => {
    scrolledTo(1200)
    holdScroll()
    contentBottom = 1600
    runFrames(3)
    window.dispatchEvent(new Event("wheel"))
    expect(isScrollHeld()).toBe(false)
    expect(document.body.style.minHeight).toBe("")
  })

  it("lets go when something else moves the page under it", () => {
    scrolledTo(700)
    holdScroll()
    runFrame()
    scrollY = 300 // a scrollbar drag, find-in-page, a focus
    runFrame()
    expect(isScrollHeld()).toBe(false)
  })

  it("holds nothing under reduced motion", () => {
    reduced = true
    scrolledTo(400)
    const release = holdScroll({ to: 0 })
    expect(isScrollHeld()).toBe(false)
    expect(frames).toHaveLength(0)
    release()
  })
})
