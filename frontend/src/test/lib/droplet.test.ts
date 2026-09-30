import { describe, expect, it } from "vitest"
import {
  DROPLET_OPEN,
  DROPLET_START,
  DROPLET_TOP_ZONE,
  DROPLET_TRAVEL,
  trackDropletScroll,
  type DropletTrack,
} from "@/lib/droplet"

/** Feed a sequence of scroll positions through the tracker, as the browser would. */
function scroll(positions: number[], from: DropletTrack = DROPLET_START): DropletTrack {
  return positions.reduce(trackDropletScroll, from)
}

const folded = (t: DropletTrack) => t.state.condensed && t.state.hidden

describe("trackDropletScroll", () => {
  it("is always whole near the top of the page", () => {
    const deep = scroll([200, 400, 600, 800])
    expect(folded(deep)).toBe(true)
    expect(scroll([DROPLET_TOP_ZONE - 1], deep).state).toEqual(DROPLET_OPEN)
    expect(scroll([0], deep).state).toEqual(DROPLET_OPEN)
  })

  it("folds away while the reader scrolls down into the page", () => {
    expect(folded(scroll([200, 240, 280]))).toBe(true)
  })

  it("comes back whole the moment the reader scrolls up far enough", () => {
    const deep = scroll([200, 400, 600])
    expect(scroll([580], deep).state).toEqual(DROPLET_OPEN)
  })

  it("answers a slow scroll too: travel is summed since the scroll turned, not counted per frame", () => {
    // Three pixels a frame is a gentle drag at 60Hz. It used to be ignored forever.
    const deep = scroll([200, 400, 600])
    const slowUp = [597, 594, 591, 588, 585]
    expect(scroll(slowUp, deep).state).toEqual(DROPLET_OPEN)
    const wholeAgain = scroll([200, 400, 600, 560])
    expect(folded(wholeAgain)).toBe(false)
    const slowDown = [563, 566, 569, 572, 575, 578]
    expect(folded(scroll(slowDown, wholeAgain))).toBe(true)
  })

  it("ignores the tiny opposite deltas of a trackpad", () => {
    const deep = scroll([200, 400, 600])
    const shiver = scroll([600 - DROPLET_TRAVEL + 1, 600, 600 - DROPLET_TRAVEL + 1], deep)
    expect(folded(shiver)).toBe(true)
  })

  it("keeps the same state object when nothing changes, so React skips the render", () => {
    const deep = scroll([200, 400, 600])
    expect(scroll([700, 800], deep).state).toBe(deep.state)
  })

  it("treats a nonsense position as the top", () => {
    const deep = scroll([200, 400, 600])
    expect(scroll([Number.NaN], deep).state).toEqual(DROPLET_OPEN)
  })
})
