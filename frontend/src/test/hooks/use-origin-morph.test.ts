import { afterEach, describe, expect, it } from "vitest"
import { dropMorph, measureAtRest, morphAt, morphFrom } from "@/hooks/use-origin-morph"
import { forgetOrigin, rememberOrigin, takeOriginShape } from "@/lib/shared-origin"

const BUTTON = { left: 1068, top: 154, width: 191, height: 44 }
const SHEET = { left: 288, top: 90, width: 864, height: 600 }

describe("morphFrom", () => {
  it("starts the surface as the control's rectangle, centre on centre, each axis its own", () => {
    const m = morphFrom(BUTTON, SHEET, 22, 20)
    expect(m).toMatchObject({ grow: true, x: 444, y: 176 - 390, radius: 22, restRadius: 20, origin: BUTTON })
    expect(m.sx).toBeCloseTo(191 / 864, 6)
    expect(m.sy).toBeCloseTo(44 / 600, 6)
  })

  it("never gives the control corners rounder than its own half-height", () => {
    expect(morphFrom(BUTTON, SHEET, 9999, 20).radius).toBe(22)
    expect(morphFrom(BUTTON, SHEET, -4, 20).radius).toBe(0)
  })
})

describe("morphAt", () => {
  const m = morphFrom(BUTTON, SHEET, 22, 20)

  it("is exactly the control at 0: its size, its corners, the content hidden at natural size", () => {
    const at = morphAt(0, m)
    expect(at.x * 1).toBe(m.x)
    expect(SHEET.width * at.sx).toBeCloseTo(BUTTON.width, 6)
    expect(SHEET.height * at.sy).toBeCloseTo(BUTTON.height, 6)
    // A 22px corner on screen, drawn per axis on the scaled surface.
    const [rx, ry] = at.radius.split(" / ").map(parseFloat)
    expect(rx * at.sx).toBeCloseTo(22, 6)
    expect(ry * at.sy).toBeCloseTo(22, 6)
    expect(at.opacity).toBe(0)
    expect(at.contentScaleX * at.sx).toBeCloseTo(1, 6)
    expect(at.contentScaleY * at.sy).toBeCloseTo(1, 6)
    expect(at.contentOpacity).toBe(0)
  })

  it("is the surface at rest at 1", () => {
    expect(morphAt(1, m)).toEqual({
      x: 0, y: 0, sx: 1, sy: 1, radius: "20px / 20px", opacity: 1,
      contentScaleX: 1, contentScaleY: 1, contentOpacity: 1,
    })
  })

  it("shows the surface early and the content only once there is room for it", () => {
    expect(morphAt(0.16, m).opacity).toBe(1)
    expect(morphAt(0.42, m).contentOpacity).toBe(0)
    expect(morphAt(0.75, m).contentOpacity).toBeCloseTo(1, 6)
  })

  it("clamps a spring's overshoot instead of growing past rest", () => {
    expect(morphAt(1.08, m)).toEqual(morphAt(1, m))
  })

  it("drops in without counter-scaling, fading with the progress", () => {
    const drop = dropMorph(20, 20, 0.95)
    expect(morphAt(0, drop)).toMatchObject({ y: 20, sx: 0.95, sy: 0.95, opacity: 0, contentScaleX: 1, contentOpacity: 1 })
    expect(morphAt(0.5, drop).opacity).toBe(0.5)
  })
})

describe("measureAtRest", () => {
  it("reads the rect and corners with the inline transform and radius lifted, then puts them back", () => {
    const el = document.createElement("div")
    document.body.append(el)
    el.style.transform = "scale(0.5)"
    el.style.borderRadius = "3px / 9px"
    el.className = "probe"
    const style = document.createElement("style")
    // Longhand: jsdom does not expand the `border-radius` shorthand for getComputedStyle.
    style.textContent = ".probe { border-top-left-radius: 20px }"
    document.head.append(style)
    let seen = ""
    el.getBoundingClientRect = () => {
      seen = `${el.style.transform}|${el.style.borderRadius}`
      return new DOMRect(10, 20, 300, 200)
    }

    expect(measureAtRest(el)).toEqual({ rect: { top: 20, left: 10, width: 300, height: 200 }, radius: 20 })
    expect(seen).toBe("none|")
    expect(el.style.transform).toBe("scale(0.5)")
    expect(el.style.borderRadius).toBe("3px / 9px")
    el.remove()
    style.remove()
  })
})

describe("takeOriginShape", () => {
  afterEach(() => forgetOrigin())

  it("carries the pressed element's corner radius with its rect, once", () => {
    const button = document.createElement("button")
    button.style.borderTopLeftRadius = "22px"
    document.body.append(button)
    button.getBoundingClientRect = () => new DOMRect(1068, 154, 191, 44)
    rememberOrigin(button)

    expect(takeOriginShape()).toEqual({ rect: { top: 154, left: 1068, width: 191, height: 44 }, radius: 22 })
    expect(takeOriginShape()).toBeNull()
    button.remove()
  })
})
