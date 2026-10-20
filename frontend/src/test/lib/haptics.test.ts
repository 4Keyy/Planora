import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { haptic } from "@/lib/haptics"

describe("haptic()", () => {
  let vibrateSpy: ReturnType<typeof vi.fn>
  const originalVibrate = Object.getOwnPropertyDescriptor(navigator, "vibrate")

  beforeEach(() => {
    vibrateSpy = vi.fn(() => true)
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      writable: true,
      value: vibrateSpy,
    })
    // Default: motion allowed.
    vi.stubGlobal("matchMedia", vi.fn((q: string) => ({
      matches: false,
      media: q,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    if (originalVibrate) Object.defineProperty(navigator, "vibrate", originalVibrate)
    else Reflect.deleteProperty(navigator, "vibrate")
  })

  it("vibrates with the tap pattern by default", () => {
    haptic()
    expect(vibrateSpy).toHaveBeenCalledWith(8)
  })

  it("vibrates with the success pattern", () => {
    haptic("success")
    expect(vibrateSpy).toHaveBeenCalledWith([10, 28, 14])
  })

  it("vibrates with the error pattern", () => {
    haptic("error")
    expect(vibrateSpy).toHaveBeenCalledWith([22, 40, 22])
  })

  it("is a no-op when navigator.vibrate is unavailable", () => {
    // @ts-expect-error — simulate iOS Safari / desktop where vibrate is absent.
    delete navigator.vibrate
    expect(() => haptic("tap")).not.toThrow()
    expect(vibrateSpy).not.toHaveBeenCalled()
  })

  it("does not vibrate when prefers-reduced-motion is set", () => {
    vi.stubGlobal("matchMedia", vi.fn((q: string) => ({
      matches: q.includes("reduce"),
      media: q,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })))
    haptic("success")
    expect(vibrateSpy).not.toHaveBeenCalled()
  })

  it("swallows errors thrown by navigator.vibrate", () => {
    vibrateSpy.mockImplementation(() => {
      throw new Error("blocked outside user gesture")
    })
    expect(() => haptic("tap")).not.toThrow()
  })
})
