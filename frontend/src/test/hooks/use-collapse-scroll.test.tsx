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
})
