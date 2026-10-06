import { act, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useCollapseScroll } from "@/hooks/use-collapse-scroll"

describe("useCollapseScroll", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("scrolls to top when an open panel closes and the page is scrolled", () => {
    Object.defineProperty(window, "scrollY", { value: 100, configurable: true })
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined)
    let calls = 0
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      calls += 1
      callback(performance.now() + (calls === 1 ? 100 : 650))
      return 1
    })

    const { rerender } = renderHook(({ isOpen }) => useCollapseScroll(isOpen), {
      initialProps: { isOpen: true },
    })
    act(() => rerender({ isOpen: false }))

    expect(scrollTo).toHaveBeenCalledWith(0, 0)
    expect(raf).toHaveBeenCalled()
  })

  it("locks height before collapse and restores styles on unmount", () => {
    Object.defineProperty(window, "scrollY", { value: 120, configurable: true })
    Object.defineProperty(window, "innerHeight", { value: 700, configurable: true })
    Object.defineProperty(document.body, "scrollHeight", { value: 1200, configurable: true })
    Object.defineProperty(document.documentElement, "scrollHeight", { value: 900, configurable: true })
    document.documentElement.style.overflowAnchor = "auto"
    document.documentElement.style.scrollBehavior = "smooth"
    document.body.style.minHeight = "10px"

    const { result, unmount } = renderHook(() => useCollapseScroll(true))

    act(() => result.current())

    expect(document.documentElement.style.overflowAnchor).toBe("none")
    expect(document.documentElement.style.scrollBehavior).toBe("auto")
    expect(document.body.style.minHeight).toBe("1200px")

    unmount()

    expect(document.documentElement.style.overflowAnchor).toBe("auto")
    expect(document.documentElement.style.scrollBehavior).toBe("smooth")
    expect(document.body.style.minHeight).toBe("10px")
  })

  it("does not scroll when the panel remains open or page is already at top", () => {
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true })
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined)

    const { rerender } = renderHook(({ isOpen }) => useCollapseScroll(isOpen), {
      initialProps: { isOpen: true },
    })
    rerender({ isOpen: true })
    rerender({ isOpen: false })

    expect(scrollTo).not.toHaveBeenCalled()
  })

  it("unlocks immediately if scroll reaches the top before animation starts", () => {
    let scrollReads = 0
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      get: () => {
        scrollReads += 1
        return scrollReads === 1 ? 1 : 0
      },
    })
    Object.defineProperty(window, "innerHeight", { value: 700, configurable: true })
    Object.defineProperty(document.body, "scrollHeight", { value: 1000, configurable: true })
    Object.defineProperty(document.documentElement, "scrollHeight", { value: 900, configurable: true })
    document.documentElement.style.overflowAnchor = "auto"
    document.documentElement.style.scrollBehavior = "smooth"
    document.body.style.minHeight = "10px"
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined)

    const { rerender } = renderHook(({ isOpen }) => useCollapseScroll(isOpen), {
      initialProps: { isOpen: true },
    })

    act(() => rerender({ isOpen: false }))

    expect(scrollTo).not.toHaveBeenCalled()
    expect(document.documentElement.style.overflowAnchor).toBe("auto")
    expect(document.documentElement.style.scrollBehavior).toBe("smooth")
    expect(document.body.style.minHeight).toBe("10px")
  })

  it("jumps instead of gliding under reduced motion", () => {
    Object.defineProperty(window, "scrollY", { value: 300, configurable: true })
    document.body.style.minHeight = ""
    // jsdom has no matchMedia; this one reports the reader's reduced-motion preference.
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({ matches: query.includes("reduce"), media: query }) as MediaQueryList,
    })
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined)
    const raf = vi.spyOn(window, "requestAnimationFrame")

    const { rerender } = renderHook(({ isOpen }) => useCollapseScroll(isOpen), { initialProps: { isOpen: true } })
    act(() => rerender({ isOpen: false }))

    expect(scrollTo).toHaveBeenCalledWith(0, 0)
    expect(raf).not.toHaveBeenCalled()
    expect(document.body.style.minHeight).toBe("")
    Reflect.deleteProperty(window, "matchMedia")
  })

  it("hands the page back the moment the reader scrolls, and stops on unmount", () => {
    Object.defineProperty(window, "scrollY", { value: 400, configurable: true })
    document.body.style.minHeight = ""
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined)
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => { frames.push(cb); return frames.length })
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined)

    const { rerender, unmount } = renderHook(({ isOpen }) => useCollapseScroll(isOpen), { initialProps: { isOpen: true } })
    act(() => rerender({ isOpen: false }))
    act(() => frames.shift()!(performance.now() + 100))
    const writes = scrollTo.mock.calls.length
    expect(writes).toBeGreaterThan(0)

    // The reader takes the wheel: the glide stops, the height lock comes off.
    act(() => { window.dispatchEvent(new WheelEvent("wheel")) })
    for (const cb of frames.splice(0)) act(() => cb(performance.now() + 300))
    expect(scrollTo.mock.calls.length).toBe(writes)
    expect(document.body.style.minHeight).toBe("")

    // A second glide, cut short by unmount.
    act(() => rerender({ isOpen: true }))
    act(() => rerender({ isOpen: false }))
    unmount()
    const afterUnmount = scrollTo.mock.calls.length
    for (const cb of frames.splice(0)) act(() => cb(performance.now() + 300))
    expect(scrollTo.mock.calls.length).toBe(afterUnmount)
  })
})
