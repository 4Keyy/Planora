import { render, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { hexToVec3, ColorBends } from "@/components/backgrounds/color-bends"
import { ColorBendsLayer } from "@/components/backgrounds/color-bends-layer"

// ─── WebGL context mock ───────────────────────────────────────────────────────
//
// jsdom has no GPU, so `canvas.getContext("webgl")` returns null and the component
// bails out before it registers a single listener. This stub is the whole WebGL 1
// surface the component touches, and no more: every entry is a spy, so a test can
// assert on the exact calls (did it delete the program on unmount? did it lose the
// context?) instead of on a library's behaviour.
//
// `getShaderParameter` / `getProgramParameter` return true so compilation and
// linking "succeed"; a test that wants the failure path overrides them.

const GLMock = vi.hoisted(() => {
  const contexts: Record<string, ReturnType<typeof vi.fn>>[] = []
  const loseContext = vi.fn()

  const make = () => {
    const gl: Record<string, unknown> = {
      // Enum values the component passes back to us. Their numbers are irrelevant
      // to the stub — only their identity matters.
      VERTEX_SHADER: 35633, FRAGMENT_SHADER: 35632, COMPILE_STATUS: 35713,
      LINK_STATUS: 35714, ARRAY_BUFFER: 34962, STATIC_DRAW: 35044, FLOAT: 5126,
      TRIANGLE_STRIP: 5, COLOR_BUFFER_BIT: 16384, DEPTH_TEST: 2929, BLEND: 3042,

      createShader: vi.fn(() => ({})),
      shaderSource: vi.fn(),
      compileShader: vi.fn(),
      getShaderParameter: vi.fn(() => true),
      getShaderInfoLog: vi.fn(() => ""),
      deleteShader: vi.fn(),
      createProgram: vi.fn(() => ({})),
      attachShader: vi.fn(),
      linkProgram: vi.fn(),
      getProgramParameter: vi.fn(() => true),
      getProgramInfoLog: vi.fn(() => ""),
      deleteProgram: vi.fn(),
      useProgram: vi.fn(),
      getUniformLocation: vi.fn((_p: unknown, name: string) => ({ name })),
      getAttribLocation: vi.fn(() => 0),
      createBuffer: vi.fn(() => ({})),
      bindBuffer: vi.fn(),
      bufferData: vi.fn(),
      deleteBuffer: vi.fn(),
      enableVertexAttribArray: vi.fn(),
      vertexAttribPointer: vi.fn(),
      enable: vi.fn(),
      disable: vi.fn(),
      clearColor: vi.fn(),
      clear: vi.fn(),
      viewport: vi.fn(),
      drawArrays: vi.fn(),
      uniform1f: vi.fn(),
      uniform1i: vi.fn(),
      uniform2f: vi.fn(),
      uniform3fv: vi.fn(),
      getExtension: vi.fn((name: string) => (name === "WEBGL_lose_context" ? { loseContext } : null)),
    }
    contexts.push(gl as Record<string, ReturnType<typeof vi.fn>>)
    return gl
  }

  return { make, contexts, loseContext }
})

// ─── Browser API stubs ────────────────────────────────────────────────────────

class ObserverStub { observe = vi.fn(); disconnect = vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
  GLMock.contexts.length = 0
  // Every canvas created in a test hands back the stub context.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    ((type: string) => (type === "webgl" ? GLMock.make() : null)) as unknown as HTMLCanvasElement["getContext"]
  )
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
    expect(v[0]).toBeCloseTo(0); expect(v[1]).toBeCloseTo(0); expect(v[2]).toBeCloseTo(0)
  })

  it("converts #ffffff to (1,1,1)", () => {
    const v = hexToVec3("#ffffff")
    expect(v[0]).toBeCloseTo(1); expect(v[1]).toBeCloseTo(1); expect(v[2]).toBeCloseTo(1)
  })

  it("converts red #ff0000 to (1,0,0)", () => {
    const v = hexToVec3("#ff0000")
    expect(v[0]).toBeCloseTo(1); expect(v[1]).toBeCloseTo(0); expect(v[2]).toBeCloseTo(0)
  })

  it("expands 3-digit shorthand #f00 to (1,0,0)", () => {
    const v = hexToVec3("#f00")
    expect(v[0]).toBeCloseTo(1); expect(v[1]).toBeCloseTo(0); expect(v[2]).toBeCloseTo(0)
  })

  it("expands 3-digit shorthand #fff to (1,1,1)", () => {
    const v = hexToVec3("#fff")
    expect(v[0]).toBeCloseTo(1); expect(v[1]).toBeCloseTo(1); expect(v[2]).toBeCloseTo(1)
  })

  it("converts #808080 to equal rgb channels", () => {
    const v = hexToVec3("#808080")
    expect(v[0]).toBeCloseTo(0x80 / 255)
    expect(v[0]).toBeCloseTo(v[1])
    expect(v[1]).toBeCloseTo(v[2])
  })

  it("works without a leading hash", () => {
    const v = hexToVec3("aabbcc")
    expect(v[0]).toBeCloseTo(0xaa / 255)
    expect(v[1]).toBeCloseTo(0xbb / 255)
    expect(v[2]).toBeCloseTo(0xcc / 255)
  })

  it("returns a three-channel tuple in 0..1", () => {
    const v = hexToVec3("#123456")
    expect(Array.isArray(v)).toBe(true)
    expect(v).toHaveLength(3)
    for (const c of v) {
      expect(c).toBeGreaterThanOrEqual(0)
      expect(c).toBeLessThanOrEqual(1)
    }
  })

  it("is deterministic", () => {
    expect(hexToVec3("#abcdef")[0]).toBe(hexToVec3("#abcdef")[0])
  })

  it("gray palette colors are neutral (r=g=b)", () => {
    for (const hex of ["#d4d4d4", "#9e9e9e", "#616161"]) {
      const v = hexToVec3(hex)
      expect(v[0]).toBeCloseTo(v[1])
      expect(v[1]).toBeCloseTo(v[2])
    }
  })

  it("gray palette progresses from light to dark", () => {
    const light = hexToVec3("#d4d4d4")
    const mid   = hexToVec3("#9e9e9e")
    const dark  = hexToVec3("#616161")
    expect(light[0]).toBeGreaterThan(mid[0])
    expect(mid[0]).toBeGreaterThan(dark[0])
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

  it("creates exactly one WebGL context on mount", () => {
    render(<ColorBends />)
    expect(GLMock.contexts).toHaveLength(1)
  })

  it("compiles and links the shader program on mount", () => {
    render(<ColorBends />)
    const gl = GLMock.contexts[0]
    expect(gl.compileShader).toHaveBeenCalledTimes(2)   // vertex + fragment
    expect(gl.linkProgram).toHaveBeenCalledTimes(1)
    expect(gl.drawArrays).toHaveBeenCalled()
  })

  it("renders nothing and throws nothing when WebGL is unavailable", () => {
    // Blocklisted GPU, ancient driver, or a browser with WebGL disabled: the
    // component must leave the container empty so the static CSS gradient shows
    // through, rather than appending a permanently blank canvas.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null)
    const { container } = render(<ColorBends />)
    expect(container.querySelector("canvas")).toBeNull()
  })

  it("appends the canvas to the container div", () => {
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

  it("stops the loop when reduced motion is switched on mid-session", () => {
    // The preference is a system setting, not a page load: reading it once at
    // mount left the loop running for anyone who turned it on without reloading.
    let onChange: ((e: { matches: boolean }) => void) | null = null
    Object.defineProperty(window, "matchMedia", {
      writable: true, configurable: true,
      value: vi.fn((q: string) => ({
        matches: false, media: q,
        addEventListener: vi.fn((_: string, cb: (e: { matches: boolean }) => void) => { onChange = cb }),
        removeEventListener: vi.fn(),
      })),
    })
    const cancel = vi.fn()
    vi.stubGlobal("cancelAnimationFrame", cancel)
    render(<ColorBends />)

    expect(onChange).toBeTypeOf("function")
    onChange!({ matches: true })
    expect(cancel).toHaveBeenCalled()
  })

  it("restarts the loop when reduced motion is switched back off", () => {
    let onChange: ((e: { matches: boolean }) => void) | null = null
    Object.defineProperty(window, "matchMedia", {
      writable: true, configurable: true,
      value: vi.fn((q: string) => ({
        matches: false, media: q,
        addEventListener: vi.fn((_: string, cb: (e: { matches: boolean }) => void) => { onChange = cb }),
        removeEventListener: vi.fn(),
      })),
    })
    render(<ColorBends />)

    onChange!({ matches: true })
    const raf = vi.fn(() => 7)
    vi.stubGlobal("requestAnimationFrame", raf)
    onChange!({ matches: false })
    expect(raf).toHaveBeenCalled()
  })

  it("calls cancelAnimationFrame on unmount", () => {
    const cancel = vi.fn()
    vi.stubGlobal("cancelAnimationFrame", cancel)
    const { unmount } = render(<ColorBends />)
    unmount()
    expect(cancel).toHaveBeenCalled()
  })

  it("deletes the program and the buffer when unmounted", () => {
    const { unmount } = render(<ColorBends />)
    const gl = GLMock.contexts[0]
    unmount()
    expect(gl.deleteProgram).toHaveBeenCalled()
    expect(gl.deleteBuffer).toHaveBeenCalled()
  })

  it("releases the GPU context when unmounted", () => {
    // A page is granted only a handful of live WebGL contexts; waiting for GC to
    // reclaim this one means a remount can fail to get a context at all.
    const { unmount } = render(<ColorBends />)
    unmount()
    expect(GLMock.loseContext).toHaveBeenCalled()
  })

  it("stops drawing when the GPU takes the context away", () => {
    const cancel = vi.fn()
    vi.stubGlobal("cancelAnimationFrame", cancel)
    const { container } = render(<ColorBends />)
    const canvas = container.querySelector("canvas")!
    const event = new Event("webglcontextlost", { cancelable: true })
    canvas.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)   // lets the browser restore it
    expect(cancel).toHaveBeenCalled()
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

  it("falls back to the static gradient when the shader fails to compile", () => {
    // A driver that rejects the shader must not leave a blank canvas over the page.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => {
      const gl = GLMock.make()
      gl.getShaderParameter = vi.fn(() => false)
      return gl
    }) as unknown as HTMLCanvasElement["getContext"])
    const { container } = render(<ColorBends />)
    expect(container.querySelector("canvas")).toBeNull()
    expect(errorSpy).toHaveBeenCalled()
  })

  it("falls back to the static gradient when the program fails to link", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => {
      const gl = GLMock.make()
      gl.getProgramParameter = vi.fn(() => false)
      return gl
    }) as unknown as HTMLCanvasElement["getContext"])
    const { container } = render(<ColorBends />)
    expect(container.querySelector("canvas")).toBeNull()
    expect(errorSpy).toHaveBeenCalled()
  })

  it("uploads the palette as a flat vec3 array bounded by uColorCount", () => {
    render(<ColorBends colors={["#ff0000", "#00ff00"]} />)
    const gl = GLMock.contexts[0]
    const call = gl.uniform3fv.mock.calls.at(-1)!
    const flat = call[1] as Float32Array
    expect(flat).toHaveLength(24)                       // MAX_COLORS * 3
    expect(Array.from(flat.slice(0, 6))).toEqual([1, 0, 0, 0, 1, 0])
    expect(Array.from(flat.slice(6))).toEqual(Array(18).fill(0))  // unused slots zeroed
    expect(gl.uniform1i).toHaveBeenCalledWith(expect.objectContaining({ name: "uColorCount" }), 2)
  })

  it("never uploads more than MAX_COLORS entries", () => {
    const ten = ["#111111", "#222222", "#333333", "#444444", "#555555",
                 "#666666", "#777777", "#888888", "#999999", "#aaaaaa"]
    render(<ColorBends colors={ten} />)
    const gl = GLMock.contexts[0]
    expect(gl.uniform1i).toHaveBeenCalledWith(expect.objectContaining({ name: "uColorCount" }), 8)
  })

  it("parks the loop when the tab is hidden and restarts it when shown", () => {
    const cancel = vi.fn()
    vi.stubGlobal("cancelAnimationFrame", cancel)
    render(<ColorBends />)

    Object.defineProperty(document, "visibilityState", { value: "hidden", writable: true, configurable: true })
    document.dispatchEvent(new Event("visibilitychange"))
    expect(cancel).toHaveBeenCalled()

    const raf = vi.fn(() => 5)
    vi.stubGlobal("requestAnimationFrame", raf)
    Object.defineProperty(document, "visibilityState", { value: "visible", writable: true, configurable: true })
    document.dispatchEvent(new Event("visibilitychange"))
    expect(raf).toHaveBeenCalled()
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

  // T4.10 — `iterations` is no longer hard-coded; it adapts to navigator.hardwareConcurrency.
  // The layer still renders cleanly across the three core-count buckets.
  it.each([
    ["low-end mobile", 2],
    ["typical laptop", 4],
    ["desktop / workstation", 16],
  ])("renders without throwing on %s (%i cores)", async (_label, cores) => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      Navigator.prototype,
      "hardwareConcurrency",
    )
    Object.defineProperty(navigator, "hardwareConcurrency", {
      configurable: true,
      get: () => cores,
    })

    try {
      const { container } = render(<ColorBendsLayer />)
      await waitFor(() => expect(container.querySelector("div")).not.toBeNull())
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(Navigator.prototype, "hardwareConcurrency", originalDescriptor)
      }
    }
  })

  // ── Lightweight (static gradient) fallback — no three.js / no WebGL loop ──
  // On touch / small / Save-Data / weak hardware the layer renders a static CSS
  // gradient instead of mounting the WebGL shader, so no WebGLRenderer is ever
  // constructed. Each branch of prefersLightweightBackground is exercised here.

  const expectStaticGradient = (container: HTMLElement) => {
    expect(GLMock.contexts).toHaveLength(0)
    const bg = container.querySelector('div[aria-hidden="true"]')
    expect(bg).not.toBeNull()
    expect(bg?.getAttribute("style") ?? "").toContain("gradient")
  }

  it("renders the static gradient (no WebGL) on a low-core device", () => {
    const original = Object.getOwnPropertyDescriptor(Navigator.prototype, "hardwareConcurrency")
    Object.defineProperty(navigator, "hardwareConcurrency", { configurable: true, get: () => 2 })
    try {
      const { container } = render(<ColorBendsLayer />)
      expectStaticGradient(container)
    } finally {
      if (original) Object.defineProperty(Navigator.prototype, "hardwareConcurrency", original)
    }
  })

  it("renders the static gradient on a coarse-pointer (touch) device", () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true, configurable: true,
      value: vi.fn((q: string) => ({
        matches: q.includes("coarse"), media: q,
        addEventListener: vi.fn(), removeEventListener: vi.fn(),
      })),
    })
    const { container } = render(<ColorBendsLayer />)
    expectStaticGradient(container)
  })

  it("renders the static gradient on a small viewport", () => {
    const original = window.innerWidth
    Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: 375 })
    try {
      const { container } = render(<ColorBendsLayer />)
      expectStaticGradient(container)
    } finally {
      Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: original })
    }
  })

  it("renders the static gradient when Save-Data is enabled", () => {
    Object.defineProperty(navigator, "connection", { configurable: true, value: { saveData: true } })
    try {
      const { container } = render(<ColorBendsLayer />)
      expectStaticGradient(container)
    } finally {
      // @ts-expect-error — clean the stubbed connection off navigator.
      delete navigator.connection
    }
  })

  it("renders the static gradient on a low-memory device", () => {
    Object.defineProperty(navigator, "deviceMemory", { configurable: true, value: 2 })
    try {
      const { container } = render(<ColorBendsLayer />)
      expectStaticGradient(container)
    } finally {
      // @ts-expect-error — clean the stubbed deviceMemory off navigator.
      delete navigator.deviceMemory
    }
  })
})
