import { act, render, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useRef } from "react"
import { motionValue } from "framer-motion"
import { AudienceLink, useClock, useDrift, useOnScreen } from "@/components/ui/audience-motion"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("useOnScreen", () => {
  it("answers no where there is no IntersectionObserver, so idle motion never runs blind", () => {
    vi.stubGlobal("IntersectionObserver", undefined)
    const { result } = renderHook(() => {
      const ref = useRef<HTMLDivElement>(document.createElement("div"))
      return useOnScreen(ref)
    })
    expect(result.current).toBe(false)
  })

  it("follows the observer, and lets it go on unmount", () => {
    let report: (entries: { isIntersecting: boolean }[]) => void = () => {}
    const disconnect = vi.fn()
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: typeof report) {
          report = callback
        }
        observe() {}
        disconnect = disconnect
      },
    )
    const { result, unmount } = renderHook(() => {
      const ref = useRef<HTMLDivElement>(document.createElement("div"))
      return useOnScreen(ref)
    })
    expect(result.current).toBe(false)
    act(() => report([{ isIntersecting: true }]))
    expect(result.current).toBe(true)
    act(() => report([{ isIntersecting: false }]))
    expect(result.current).toBe(false)
    unmount()
    expect(disconnect).toHaveBeenCalled()
  })
})

describe("useClock", () => {
  it("ticks only while running, holds its time when stopped, and caps a long gap", () => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb))
    vi.stubGlobal("cancelAnimationFrame", vi.fn())
    const now = vi.spyOn(performance, "now").mockReturnValue(1000)
    const { result, rerender } = renderHook(({ running }) => useClock(running), { initialProps: { running: false } })
    expect(frames).toHaveLength(0)
    rerender({ running: true })
    frames.shift()?.(1016)
    expect(result.current.get()).toBe(16)
    // A background tab's one huge step is capped.
    frames.shift()?.(5000)
    expect(result.current.get()).toBe(80)
    rerender({ running: false })
    expect(result.current.get()).toBe(80)
    now.mockRestore()
  })
})

describe("useDrift", () => {
  it("wanders a few pixels while floating and rests once settled", () => {
    const clock = motionValue(0)
    const { result, rerender } = renderHook(({ floating }) => useDrift(clock, 0.3, floating), {
      initialProps: { floating: false },
    })
    clock.set(1700)
    expect(Math.abs(result.current.x.get())).toBe(0)
    expect(Math.abs(result.current.y.get())).toBe(0)
    expect(result.current.scale.get()).toBe(1)
    rerender({ floating: true })
    // Within reach, whatever the moment.
    for (const t of [0, 900, 2600, 7300]) {
      clock.set(t)
      expect(Math.abs(result.current.x.get())).toBeLessThanOrEqual(3.2)
      expect(Math.abs(result.current.y.get())).toBeLessThanOrEqual(3.2)
    }
  })
})

describe("AudienceLink", () => {
  const ends = () => ({ cx: motionValue(0), cy: motionValue(0), sx: motionValue(120), sy: motionValue(40) })
  const link = (props: { on: boolean; reduce?: boolean; pulse?: boolean; faint?: boolean }, at = ends()) => (
    <svg>
      <AudienceLink {...at} fromEdge={56} toEdge={26} seed={0.4} reduce={props.reduce ?? false} on={props.on} pulse={props.pulse} faint={props.faint} />
    </svg>
  )

  it("draws nothing for someone who is not in", () => {
    const { container } = render(link({ on: false }))
    expect(container.querySelectorAll("path")).toHaveLength(0)
  })

  it("draws a bowed thread from the ring's edge to the seat's", () => {
    const { container } = render(link({ on: true }))
    const [, core] = container.querySelectorAll("path")
    const d = core.getAttribute("d") ?? ""
    expect(d).toMatch(/^M\d+(\.\d+)? \d+(\.\d+)? Q-?\d+(\.\d+)? -?\d+(\.\d+)? \d+(\.\d+)? \d+(\.\d+)?$/)
    const [ax, ay, , , bx, by] = d.replace(/[MQ]/g, "").trim().split(/\s+/).map(Number)
    // Starts on the ring's edge and stops short of the seat's.
    expect(Math.hypot(ax, ay)).toBeCloseTo(56, 0)
    expect(Math.hypot(120 - bx, 40 - by)).toBeCloseTo(26, 0)
  })

  it("reels a thread in before it goes, and drops it at once under reduced motion", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    const at = ends()
    const { container, rerender } = render(link({ on: true }, at))
    rerender(link({ on: false }, at))
    expect(container.querySelectorAll("path").length).toBeGreaterThan(0)
    act(() => {
      vi.advanceTimersByTime(450)
    })
    expect(container.querySelectorAll("path")).toHaveLength(0)

    rerender(link({ on: true, reduce: true }, at))
    expect(container.querySelectorAll("path").length).toBeGreaterThan(0)
    rerender(link({ on: false, reduce: true }, at))
    expect(container.querySelectorAll("path")).toHaveLength(0)
  })

  it("carries light only when asked and allowed, and answers a new arrival with a ripple", () => {
    const at = ends()
    const quiet = render(link({ on: true, pulse: false, faint: true }, at))
    expect(quiet.container.querySelectorAll("circle")).toHaveLength(0)
    quiet.unmount()

    const { container, rerender } = render(link({ on: false }, at))
    rerender(link({ on: true }, at))
    // Two for the light (halo and point), one for the ripple.
    expect(container.querySelectorAll("circle")).toHaveLength(3)

    const still = render(link({ on: true, reduce: true }, at))
    expect(still.container.querySelectorAll("circle")).toHaveLength(0)
  })
})
