import { act, render } from "@testing-library/react"
import { useCallback, useRef } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { springCurve, springEasing, useHeightTransition, type HeightTransitionOptions } from "@/hooks/use-height-transition"
import { SPRING_LAYOUT, SPRING_STANDARD } from "@/lib/animations"

const hold = vi.hoisted(() => ({
  prime: vi.fn(),
  release: vi.fn(),
  options: [] as Array<{ show?: () => Element | null; to?: number } | undefined>,
}))

vi.mock("@/lib/scroll-hold", () => ({
  primeScrollHold: hold.prime,
  trackScrollPosition: () => () => {},
  holdScroll: (options?: { show?: () => Element | null; to?: number }) => {
    hold.options.push(options)
    return hold.release
  },
}))

/** A Web Animation the test drives: its clock, and its finish and cancel events. */
class FakeAnimation {
  currentTime = 0
  private listeners: Record<string, Array<() => void>> = {}
  constructor(public keyframes: Keyframe[], public options: KeyframeAnimationOptions) {}
  addEventListener(type: string, listener: () => void) {
    ;(this.listeners[type] ??= []).push(listener)
  }
  cancel = vi.fn(() => this.emit("cancel"))
  pause = vi.fn()
  play = vi.fn()
  finish() {
    this.emit("finish")
  }
  private emit(type: string) {
    for (const listener of this.listeners[type] ?? []) listener()
  }
}

let animations: FakeAnimation[] = []
/** The content's laid-out size, as the browser would report it. */
let contentHeight = 100
let contentWidth = 300
let observerCallback: (() => void) | null = null

beforeEach(() => {
  animations = []
  contentHeight = 100
  contentWidth = 300
  observerCallback = null
  hold.prime.mockClear()
  hold.release.mockClear()
  hold.options = []
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        observerCallback = callback
      }
      observe() {}
      disconnect() {}
    },
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

type Props = Omit<HeightTransitionOptions, "content" | "spring"> & {
  revision: number
  animate?: boolean
  spring?: HeightTransitionOptions["spring"]
}

function Box({ revision, animate = true, spring = SPRING_LAYOUT, ...options }: Props) {
  const outer = useRef<HTMLDivElement | null>(null)
  const inner = useRef<HTMLDivElement | null>(null)
  useHeightTransition(outer, { content: inner, spring, ...options })
  // Stable callback refs, like the object refs a real caller passes: React re-attaches a ref
  // that changes identity on every commit, detaching it first.
  const outerRef = useCallback(
    (node: HTMLDivElement | null) => {
      outer.current = node
      if (!node || !animate) return
      node.animate = ((keyframes: Keyframe[], opts: KeyframeAnimationOptions) => {
        const animation = new FakeAnimation(keyframes, opts)
        animations.push(animation)
        return animation as unknown as Animation
      }) as HTMLElement["animate"]
    },
    [animate],
  )
  const innerRef = useCallback((node: HTMLDivElement | null) => {
    inner.current = node
    if (!node) return
    Object.defineProperty(node, "offsetHeight", { configurable: true, get: () => contentHeight })
    Object.defineProperty(node, "offsetWidth", { configurable: true, get: () => contentWidth })
  }, [])
  return (
    <div
      data-testid="outer"
      ref={outerRef}
      style={{ borderTopWidth: "1px", borderBottomWidth: "1px", borderStyle: "solid" }}
    >
      <div data-revision={revision} ref={innerRef} />
    </div>
  )
}

const heights = (animation: FakeAnimation) => animation.keyframes.map((frame) => frame.height)

describe("springCurve", () => {
  it("starts from rest and lands on the critically damped layout spring without passing its target", () => {
    const curve = springCurve(SPRING_LAYOUT)
    expect(curve.at(0)).toBeCloseTo(0, 6)
    expect(curve.velocity(0)).toBeCloseTo(0, 6)
    let last = 0
    for (let t = 0; t <= curve.duration / 1000; t += 0.01) {
      const value = curve.at(t)
      expect(value).toBeGreaterThanOrEqual(last - 1e-9)
      expect(value).toBeLessThanOrEqual(1 + 1e-9)
      last = value
    }
    expect(curve.at(curve.duration / 1000)).toBe(1)
    expect(curve.velocity(curve.duration / 1000)).toBe(0)
    // Critically damped at ω = 20: settled within 0.2% in about 0.43s.
    expect(curve.duration).toBeGreaterThan(380)
    expect(curve.duration).toBeLessThan(480)
  })

  it("carries the speed it already has into a turn, and so lands sooner", () => {
    const rest = springCurve(SPRING_LAYOUT)
    const moving = springCurve(SPRING_LAYOUT, 8)
    expect(moving.velocity(0)).toBeCloseTo(8, 6)
    expect(moving.duration).toBeLessThan(rest.duration)
  })

  it("samples under- and overdamped springs too", () => {
    const bouncy = springCurve(SPRING_STANDARD)
    expect(bouncy.at(0)).toBeCloseTo(0, 6)
    expect(Math.max(...Array.from({ length: 60 }, (_, i) => bouncy.at(i / 100)))).toBeGreaterThan(1)
    const slow = springCurve({ stiffness: 100, damping: 60 })
    expect(slow.at(0)).toBeCloseTo(0, 6)
    expect(slow.velocity(0.05)).toBeGreaterThan(0)
    expect(slow.at(slow.duration / 1000)).toBe(1)
  })

  it("writes the curve as linear() where the browser has it, and a bezier where it does not", () => {
    vi.stubGlobal("CSS", { supports: () => true })
    expect(springEasing(SPRING_LAYOUT).easing).toMatch(/^linear\(0, /)
    vi.stubGlobal("CSS", { supports: () => false })
    expect(springEasing(SPRING_LAYOUT).easing).toBe("cubic-bezier(0.4, 0, 0.2, 1)")
  })
})

describe("useHeightTransition", () => {
  it("does nothing on the first paint", () => {
    render(<Box revision={0} />)
    expect(animations).toHaveLength(0)
  })

  it("glides from the height it showed to the height its content now needs", () => {
    const { rerender } = render(<Box revision={0} />)
    contentHeight = 240
    rerender(<Box revision={1} />)
    expect(animations).toHaveLength(1)
    // 1px border above and below the content.
    expect(heights(animations[0])).toEqual(["102px", "242px"])
    expect(animations[0].options.duration).toBe(springCurve(SPRING_LAYOUT).duration)
    expect(hold.options).toHaveLength(1)
  })

  it("moves on with the frames that are drawn, never skipping through a stalled one", () => {
    const frames: FrameRequestCallback[] = []
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback)
      return frames.length
    })
    const { rerender } = render(<Box revision={0} />)
    contentHeight = 240
    rerender(<Box revision={1} />)
    const run = (time: number) => frames.splice(0).forEach((callback) => callback(time))
    const glide = animations[0]
    expect(glide.pause).toHaveBeenCalled()
    // The first frame drawn shows the first height; each frame after it moves the clock on by
    // that frame — or by two frames' worth, however long a stalled one took.
    run(1000)
    expect(glide.currentTime).toBe(0)
    run(1016)
    expect(glide.currentTime).toBe(16)
    run(1316)
    expect(glide.currentTime).toBeCloseTo(16 + 2000 / 60, 5)
    // It ends when its time is up, back on `height: auto`.
    for (let time = 1332; frames.length && time < 3000; time += 16) run(time)
    expect(glide.cancel).toHaveBeenCalled()
    expect(hold.release).toHaveBeenCalledTimes(1)
    // A glide replaced before its first frame never moves, and the old one stops ticking.
    contentHeight = 300
    rerender(<Box revision={2} />)
    contentHeight = 320
    rerender(<Box revision={3} />)
    run(4000)
    run(4016)
    expect(animations[1].currentTime).toBe(0)
    expect(animations[2].currentTime).toBe(16)
    raf.mockRestore()
  })

  it("leaves a commit that changed nothing alone", () => {
    const { rerender } = render(<Box revision={0} />)
    rerender(<Box revision={1} />)
    expect(animations).toHaveLength(0)
  })

  it("turns a running glide toward content that changed again, from where it is, at the speed it has", () => {
    const { rerender } = render(<Box revision={0} />)
    contentHeight = 40
    rerender(<Box revision={1} shape="collapsed" />)
    const first = animations[0]
    first.currentTime = 100
    contentHeight = 300
    rerender(<Box revision={2} shape="open" />)
    expect(animations).toHaveLength(2)
    const second = animations[1]
    const [from, to] = heights(second).map((value) => parseFloat(String(value)))
    const curve = springCurve(SPRING_LAYOUT)
    expect(from).toBeCloseTo(102 + (42 - 102) * curve.at(0.1), 5)
    expect(to).toBe(302)
    // Moving away from the new target: no speed toward it is carried, so it starts from rest.
    expect(second.options.duration).toBe(curve.duration)
    expect(first.cancel).toHaveBeenCalled()
    // The old glide let its hold go only after the new one opened its own.
    expect(hold.options).toHaveLength(2)
    expect(hold.release).toHaveBeenCalledTimes(1)
  })

  it("carries speed toward the new target into the turn", () => {
    const { rerender } = render(<Box revision={0} />)
    contentHeight = 300
    rerender(<Box revision={1} />)
    animations[0].currentTime = 60
    contentHeight = 360
    rerender(<Box revision={2} />)
    expect(animations[1].options.duration).toBeLessThan(springCurve(SPRING_LAYOUT).duration)
  })

  it("does not restart a glide already headed where the content now is", () => {
    const { rerender } = render(<Box revision={0} />)
    contentHeight = 300
    rerender(<Box revision={1} />)
    animations[0].currentTime = 80
    rerender(<Box revision={2} />)
    expect(animations).toHaveLength(1)
  })

  it("lets a change that came with a new width happen at once — unless the shape changed too", () => {
    const { rerender } = render(<Box revision={0} shape="open" />)
    contentHeight = 180
    contentWidth = 200
    rerender(<Box revision={1} shape="open" />)
    expect(animations).toHaveLength(0)
    contentHeight = 40
    contentWidth = 260
    rerender(<Box revision={2} shape="collapsed" />)
    expect(animations).toHaveLength(1)
  })

  it("holds the page before layout is read when the shape changes, and only then", () => {
    const { rerender } = render(<Box revision={0} shape="open" />)
    expect(hold.prime).not.toHaveBeenCalled()
    rerender(<Box revision={1} shape="open" />)
    expect(hold.prime).not.toHaveBeenCalled()
    contentHeight = 40
    rerender(<Box revision={2} shape="collapsed" />)
    expect(hold.prime).toHaveBeenCalledTimes(1)
  })

  it("changes in one step under reduced motion, stopping a glide that was running", () => {
    const { rerender } = render(<Box revision={0} shape="open" />)
    contentHeight = 40
    rerender(<Box revision={1} shape="collapsed" />)
    const running = animations[0]
    contentHeight = 300
    rerender(<Box revision={2} shape="open" disabled />)
    expect(animations).toHaveLength(1)
    expect(running.cancel).toHaveBeenCalled()
    expect(hold.prime).toHaveBeenCalledTimes(1)
  })

  it("does nothing where the element cannot animate", () => {
    const { rerender } = render(<Box revision={0} animate={false} shape="open" />)
    contentHeight = 40
    rerender(<Box revision={1} animate={false} shape="collapsed" />)
    expect(hold.prime).not.toHaveBeenCalled()
  })

  it("follows content that changes outside a commit while it glides, and only then", () => {
    const { rerender } = render(<Box revision={0} />)
    contentHeight = 120
    act(() => observerCallback?.())
    expect(animations).toHaveLength(0)
    contentHeight = 300
    rerender(<Box revision={1} />)
    animations[0].currentTime = 50
    contentHeight = 340
    act(() => observerCallback?.())
    expect(animations).toHaveLength(2)
    expect(heights(animations[1]).at(-1)).toBe("342px")
    contentHeight = 340
    act(() => observerCallback?.())
    expect(animations).toHaveLength(2)
  })

  it("releases the page and forgets the glide once it lands", () => {
    const { rerender } = render(<Box revision={0} />)
    contentHeight = 300
    rerender(<Box revision={1} />)
    act(() => animations[0].finish())
    expect(hold.release).toHaveBeenCalledTimes(1)
    // At rest again: a change with a new width is a reflow, so nothing glides.
    contentHeight = 320
    contentWidth = 280
    rerender(<Box revision={2} />)
    expect(animations).toHaveLength(1)
  })

  it("stops its glide when it unmounts", () => {
    const { rerender, unmount } = render(<Box revision={0} />)
    contentHeight = 300
    rerender(<Box revision={1} />)
    unmount()
    expect(animations[0].cancel).toHaveBeenCalled()
  })

  it("clips only below its edge when asked to", () => {
    const { rerender } = render(<Box revision={0} clipBelow />)
    contentHeight = 300
    rerender(<Box revision={1} clipBelow />)
    expect(animations[0].keyframes.every((frame) => frame.clipPath === "inset(-64px -64px 0px -64px)")).toBe(true)
  })

  it("keeps a folding card's top in view, and a toggle the keyboard was handed", () => {
    const { rerender, getByTestId } = render(<Box revision={0} keepInView />)
    const outer = getByTestId("outer")
    contentHeight = 40
    rerender(<Box revision={1} keepInView />)
    const folding = hold.options[0]?.show
    expect(folding?.()).toBe(outer)

    const toggle = document.createElement("button")
    outer.appendChild(toggle)
    toggle.focus()
    toggle.matches = ((selector: string) => selector === ":focus-visible") as typeof toggle.matches
    expect(folding?.()).toBe(toggle)

    // A click's focus draws no ring, so it does not move the page; a glide that grows keeps nothing.
    toggle.matches = (() => {
      throw new SyntaxError("unsupported")
    }) as typeof toggle.matches
    expect(folding?.()).toBe(outer)
    act(() => animations[0].finish())
    contentHeight = 300
    rerender(<Box revision={2} keepInView />)
    expect(hold.options[1]?.show?.()).toBeNull()
  })

  it("asks to keep nothing in view by default", () => {
    const { rerender } = render(<Box revision={0} />)
    contentHeight = 40
    rerender(<Box revision={1} />)
    expect(hold.options[0]?.show).toBeUndefined()
  })
})
