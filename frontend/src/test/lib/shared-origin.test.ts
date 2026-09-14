import { afterEach, describe, expect, it, vi } from "vitest"
import {
  editorDialogRect,
  forgetOrigin,
  originTransform,
  rememberOrigin,
  takeOrigin,
  type OriginRect,
} from "@/lib/shared-origin"

/** A stand-in for an element, since jsdom reports every rect as zero. */
function elementAt(rect: OriginRect): HTMLElement {
  const el = document.createElement("div")
  el.getBoundingClientRect = () =>
    ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height, x: rect.left, y: rect.top, toJSON: () => rect }) as DOMRect
  return el
}

afterEach(() => {
  forgetOrigin()
  vi.restoreAllMocks()
})

describe("the origin slot", () => {
  it("hands back the rect that was recorded", () => {
    rememberOrigin(elementAt({ top: 120, left: 40, width: 320, height: 180 }))
    expect(takeOrigin()).toEqual({ top: 120, left: 40, width: 320, height: 180 })
  })

  it("is consumed on read, so a second dialog does not fly out of the first one's card", () => {
    rememberOrigin(elementAt({ top: 10, left: 10, width: 100, height: 100 }))
    expect(takeOrigin()).not.toBeNull()
    expect(takeOrigin()).toBeNull()
  })

  it("holds nothing when there was no element — the palette and deep links open plainly", () => {
    rememberOrigin(null)
    expect(takeOrigin()).toBeNull()
  })

  it("rejects a zero-area rect rather than scaling the dialog down to nothing", () => {
    // A display:none or detached node measures 0x0; animating from it flashes.
    rememberOrigin(elementAt({ top: 0, left: 0, width: 0, height: 0 }))
    expect(takeOrigin()).toBeNull()
  })

  it("discards a rect the user has had time to walk away from", () => {
    const now = vi.spyOn(performance, "now")
    now.mockReturnValue(0)
    rememberOrigin(elementAt({ top: 0, left: 0, width: 200, height: 100 }))
    now.mockReturnValue(1500)
    expect(takeOrigin()).toBeNull()
  })

  it("keeps a rect that is still fresh", () => {
    const now = vi.spyOn(performance, "now")
    now.mockReturnValue(0)
    rememberOrigin(elementAt({ top: 0, left: 0, width: 200, height: 100 }))
    now.mockReturnValue(400)
    expect(takeOrigin()).not.toBeNull()
  })
})

describe("originTransform", () => {
  const target: OriginRect = { top: 40, left: 390, width: 660, height: 760 }

  it("translates centre to centre", () => {
    // A card whose centre is 200px left of and 100px above the dialog's centre
    // must start exactly there, or the surface appears to jump before it grows.
    const origin: OriginRect = { top: 320, left: 320, width: 400, height: 200 }
    const t = originTransform(origin, target)
    const originCx = origin.left + origin.width / 2
    const originCy = origin.top + origin.height / 2
    expect(t.x).toBe(Math.round(originCx - (target.left + target.width / 2)))
    expect(t.y).toBe(Math.round(originCy - (target.top + target.height / 2)))
  })

  it("scales uniformly from the width ratio", () => {
    // Not the height ratio, and not both independently: a non-uniform scale
    // shears every glyph in the dialog for the length of the transition.
    const origin: OriginRect = { top: 0, left: 0, width: 495, height: 120 }
    expect(originTransform(origin, target).scale).toBeCloseTo(0.75, 5)
  })

  it("clamps a tiny card to the floor instead of expanding a speck", () => {
    const origin: OriginRect = { top: 0, left: 0, width: 40, height: 40 }
    expect(originTransform(origin, target).scale).toBe(0.55)
  })

  it("never starts larger than the dialog", () => {
    const origin: OriginRect = { top: 0, left: 0, width: 1200, height: 400 }
    expect(originTransform(origin, target).scale).toBe(1)
  })

  it("survives a zero-width target without producing NaN", () => {
    const t = originTransform({ top: 0, left: 0, width: 100, height: 100 }, { top: 0, left: 0, width: 0, height: 0 })
    expect(Number.isFinite(t.x) && Number.isFinite(t.y) && Number.isFinite(t.scale)).toBe(true)
  })
})

describe("editorDialogRect", () => {
  const geometry = { maxWidth: 660, maxHeight: 880, gutter: 16, heightRatio: 0.9 }

  it("caps at the dialog's max width on a wide screen and centres it", () => {
    const r = editorDialogRect(1440, 900, geometry)
    expect(r.width).toBe(660)
    expect(r.left).toBe((1440 - 660) / 2)
  })

  it("fills the gutters on a phone", () => {
    // 390 - 2*16 — the wrapper's p-4 is the whole of the side margin.
    const r = editorDialogRect(390, 844, geometry)
    expect(r.width).toBe(358)
    expect(r.left).toBe(16)
  })

  it("caps the height on a tall screen", () => {
    expect(editorDialogRect(1440, 1600, geometry).height).toBe(880)
  })

  it("uses the ratio on a short screen", () => {
    expect(editorDialogRect(1440, 800, geometry).height).toBeCloseTo(720, 5)
  })
})
