import { render, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Vector3 } from "three"
import { hexToVec3, ColorBends } from "@/components/backgrounds/color-bends"
import { ColorBendsLayer } from "@/components/backgrounds/color-bends-layer"

// ─── Three.js WebGLRenderer mock (vi.hoisted = available before vi.mock) ─────

const MockedRenderer = vi.hoisted(() => {
  const instances: {
    domElement: HTMLCanvasElement
    outputColorSpace: string
    setPixelRatio: ReturnType<typeof vi.fn>
    setClearColor:   ReturnType<typeof vi.fn>
    setSize:         ReturnType<typeof vi.fn>
    render:          ReturnType<typeof vi.fn>
    dispose:         ReturnType<typeof vi.fn>
    forceContextLoss: ReturnType<typeof vi.fn>
  }[] = []

  class WebGLRendererMock {
    domElement!:      HTMLCanvasElement
    outputColorSpace = ""
    setPixelRatio    = vi.fn()
    setClearColor    = vi.fn()
    setSize          = vi.fn()
    render           = vi.fn()
    dispose          = vi.fn()
    forceContextLoss = vi.fn()
    constructor() {
      this.domElement = document.createElement("canvas")
      instances.push(this as unknown as typeof instances[number])
    }
  }

  return { WebGLRendererMock, instances }
})

vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>()
  return { ...actual, WebGLRenderer: MockedRenderer.WebGLRendererMock }
})

// ─── Browser API stubs ────────────────────────────────────────────────────────

class ObserverStub { observe = vi.fn(); disconnect = vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
  MockedRenderer.instances.length = 0
  vi.stubGlobal("ResizeObserver", ObserverStub)
  vi.stubGlobal("IntersectionObserver", ObserverStub)
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1))
  vi.stubGlobal("cancelAnimationFrame", vi.fn())
  Object.defineProperty(window, "matchMedia", {
    writable: true, configurable: true,
    value: vi.fn((q: string) => ({ matches: false, media: q, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  })
  Object.defineProperty(document, "visibilityState", { value: "visible", writable: true, configurable: true })
  Object.defineProperty(window, "devicePixelRatio", { value: 1, writable: true, configurable: true })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// ─── hexToVec3 ────────────────────────────────────────────────────────────────

describe("hexToVec3()", () => {
  it("converts #000000 to (0,0,0)", () => {
    const v = hexToVec3("#000000")
    expect(v.x).toBeCloseTo(0); expect(v.y).toBeCloseTo(0); expect(v.z).toBeCloseTo(0)
  })

  it("converts #ffffff to (1,1,1)", () => {
    const v = hexToVec3("#ffffff")
    expect(v.x).toBeCloseTo(1); expect(v.y).toBeCloseTo(1); expect(v.z).toBeCloseTo(1)
  })

  it("converts red #ff0000 to (1,0,0)", () => {
    const v = hexToVec3("#ff0000")
    expect(v.x).toBeCloseTo(1); expect(v.y).toBeCloseTo(0); expect(v.z).toBeCloseTo(0)
  })

  it("expands 3-digit shorthand #f00 to (1,0,0)", () => {
    const v = hexToVec3("#f00")
    expect(v.x).toBeCloseTo(1); expect(v.y).toBeCloseTo(0); expect(v.z).toBeCloseTo(0)
  })

  it("expands 3-digit shorthand #fff to (1,1,1)", () => {
    const v = hexToVec3("#fff")
    expect(v.x).toBeCloseTo(1); expect(v.y).toBeCloseTo(1); expect(v.z).toBeCloseTo(1)
  })

  it("converts #808080 to equal rgb channels", () => {
    const v = hexToVec3("#808080")
    expect(v.x).toBeCloseTo(0x80 / 255)
    expect(v.x).toBeCloseTo(v.y)
    expect(v.y).toBeCloseTo(v.z)
  })

  it("works without a leading hash", () => {
    const v = hexToVec3("aabbcc")
    expect(v.x).toBeCloseTo(0xaa / 255)
    expect(v.y).toBeCloseTo(0xbb / 255)
    expect(v.z).toBeCloseTo(0xcc / 255)
  })

  it("returns a Vector3 instance", () => {
    expect(hexToVec3("#123456")).toBeInstanceOf(Vector3)
  })

  it("is deterministic", () => {
    expect(hexToVec3("#abcdef").x).toBe(hexToVec3("#abcdef").x)
  })

  it("gray palette colors are neutral (r=g=b)", () => {
    for (const hex of ["#d4d4d4", "#9e9e9e", "#616161"]) {
      const v = hexToVec3(hex)
      expect(v.x).toBeCloseTo(v.y)
      expect(v.y).toBeCloseTo(v.z)
    }
  })

  it("gray palette progresses from light to dark", () => {
    const light = hexToVec3("#d4d4d4")
    const mid   = hexToVec3("#9e9e9e")
    const dark  = hexToVec3("#616161")
    expect(light.x).toBeGreaterThan(mid.x)
    expect(mid.x).toBeGreaterThan(dark.x)
  })
})

// ─── ColorBends component ─────────────────────────────────────────────────────

describe("ColorBends", () => {
  it("renders a div container", () => {
    const { container } = render(<ColorBends />)
    expect(container.querySelector("div")).not.toBeNull()
  })

  it("renders exactly one div", () => {
    const { container } = render(<ColorBends />)
    expect(container.querySelectorAll("div")).toHaveLength(1)
  })

  it("creates a WebGLRenderer instance on mount", () => {
    render(<ColorBends />)
    expect(MockedRenderer.instances).toHaveLength(1)
  })

  it("appends renderer canvas to the container div", () => {
    const { container } = render(<ColorBends />)
    const canvas = container.querySelector("canvas")
    expect(canvas).not.toBeNull()
  })

  it("starts requestAnimationFrame (normal motion)", () => {
    render(<ColorBends />)
    expect(requestAnimationFrame).toHaveBeenCalled()
  })

  it("does not start RAF when prefers-reduced-motion is active", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true, configurable: true,
      value: vi.fn((q: string) => ({
        matches: q.includes("reduce"), media: q,
        addEventListener: vi.fn(), removeEventListener: vi.fn(),
      })),
    })
    const raf = vi.fn(() => 0)
    vi.stubGlobal("requestAnimationFrame", raf)
    render(<ColorBends />)
    expect(raf).not.toHaveBeenCalled()
  })

  it("calls cancelAnimationFrame on unmount", () => {
    const cancel = vi.fn()
    vi.stubGlobal("cancelAnimationFrame", cancel)
    const { unmount } = render(<ColorBends />)
    unmount()
    expect(cancel).toHaveBeenCalled()
  })

  it("calls dispose() on the renderer when unmounted", () => {
    const { unmount } = render(<ColorBends />)
    unmount()
    expect(MockedRenderer.instances[0].dispose).toHaveBeenCalled()
  })

  it("calls forceContextLoss() on the renderer when unmounted", () => {
    const { unmount } = render(<ColorBends />)
    unmount()
    expect(MockedRenderer.instances[0].forceContextLoss).toHaveBeenCalled()
  })

  it("registers ResizeObserver on mount and disconnects on unmount", () => {
    const observeSpy    = vi.fn()
    const disconnectSpy = vi.fn()
    class RO { observe = observeSpy; disconnect = disconnectSpy }
    vi.stubGlobal("ResizeObserver", RO)
    const { unmount } = render(<ColorBends />)
    expect(observeSpy).toHaveBeenCalled()
    unmount()
    expect(disconnectSpy).toHaveBeenCalled()
  })

  it("registers pointermove on window and removes it on unmount", () => {
    const addSpy    = vi.spyOn(window, "addEventListener")
    const removeSpy = vi.spyOn(window, "removeEventListener")
    const { unmount } = render(<ColorBends />)
    expect(addSpy.mock.calls.some(([e]) => e === "pointermove")).toBe(true)
    unmount()
    expect(removeSpy.mock.calls.some(([e]) => e === "pointermove")).toBe(true)
  })

  it("registers visibilitychange on document and removes it on unmount", () => {
    const addSpy    = vi.spyOn(document, "addEventListener")
    const removeSpy = vi.spyOn(document, "removeEventListener")
    const { unmount } = render(<ColorBends />)
    expect(addSpy.mock.calls.some(([e]) => e === "visibilitychange")).toBe(true)
    unmount()
    expect(removeSpy.mock.calls.some(([e]) => e === "visibilitychange")).toBe(true)
  })

  it("accepts the full gray config without crashing", () => {
    expect(() => render(
      <ColorBends
        colors={["#d4d4d4", "#9e9e9e", "#616161"]}
        rotation={-65}
        speed={0.36}
        scale={1.4}
        frequency={1}
        warpStrength={1}
        mouseInfluence={0.8}
        noise={0}
        parallax={0.65}
        iterations={2}
        intensity={1.2}
        bandWidth={6}
        transparent
      />
    )).not.toThrow()
  })

  it("applies extra className to the container div", () => {
    const { container } = render(<ColorBends className="test-class" />)
    expect(container.querySelector("div")?.className).toContain("test-class")
  })

  it("does not throw when unmounted before RAF fires", () => {
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 99))
    const { unmount } = render(<ColorBends />)
    expect(() => unmount()).not.toThrow()
  })
})

// ─── ColorBendsLayer ──────────────────────────────────────────────────────────

describe("ColorBendsLayer", () => {
  it("renders without crashing", () => {
    expect(() => render(<ColorBendsLayer />)).not.toThrow()
  })

  it("eventually renders inner content (lazy load resolves)", async () => {
    const { container } = render(<ColorBendsLayer />)
    await waitFor(() => expect(container.querySelector("div")).not.toBeNull())
  })

  it("wrapper has fixed inset-0 -z-10 classes", async () => {
    const { container } = render(<ColorBendsLayer />)
    await waitFor(() => {
      expect(container.querySelector(".fixed.inset-0.-z-10")).not.toBeNull()
    })
  })

  it("wrapper has pointer-events-none (background does not block clicks)", async () => {
    const { container } = render(<ColorBendsLayer />)
    await waitFor(() => {
      expect(container.querySelector(".pointer-events-none")).not.toBeNull()
    })
  })

  it("unmounts cleanly without throwing", async () => {
    const { unmount } = render(<ColorBendsLayer />)
    expect(() => unmount()).not.toThrow()
  })
})
