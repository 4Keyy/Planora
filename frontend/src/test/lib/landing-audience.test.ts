import { describe, expect, it } from "vitest"
import {
  ALL_FRIENDS_CAPTION,
  ceilingCaption,
  deriveAudience,
  isAtSharingCeiling,
  normalizeViewerCount,
  ringCountNoun,
  ringReading,
  SHARING_CEILING,
  viewerValueText,
} from "@/lib/landing-audience"

/**
 * The landing page's one piece of logic that can be wrong in an interesting way.
 *
 * The page compositions live under `src/app/**`, which `vitest.config.ts` excludes from
 * coverage — they have one caller each and are markup. This derivation is the part that
 * could quietly start telling the visitor something untrue, so it lives in `src/lib/`
 * and is tested here.
 */

describe("deriveAudience", () => {
  it("is private with nobody selected", () => {
    expect(deriveAudience(0)).toBe("private")
  })

  it("is shared from the first viewer onwards", () => {
    expect(deriveAudience(1)).toBe("shared")
    expect(deriveAudience(8)).toBe("shared")
    expect(deriveAudience(50)).toBe("shared")
  })

  it("never returns public from a count, because public is a setting, not a number", () => {
    // Public is the share picker's "All friends". The landing page reaches it through its
    // own switch; no number of named people ever turns into it.
    for (let n = 0; n <= 40; n++) {
      expect(deriveAudience(n)).not.toBe("public")
    }
  })

  it("treats nonsense counts as nobody rather than throwing", () => {
    expect(deriveAudience(Number.NaN)).toBe("private")
    expect(deriveAudience(-3)).toBe("private")
  })
})

describe("normalizeViewerCount", () => {
  it("floors fractions and clamps negatives", () => {
    expect(normalizeViewerCount(2.9)).toBe(2)
    expect(normalizeViewerCount(-1)).toBe(0)
    expect(normalizeViewerCount(Number.NaN)).toBe(0)
    expect(normalizeViewerCount(Number.POSITIVE_INFINITY)).toBe(0)
  })
})

describe("the sharing ceiling", () => {
  it("saturates at eight, where the cut reaches half the circumference", () => {
    expect(SHARING_CEILING).toBe(8)
    expect(isAtSharingCeiling(7)).toBe(false)
    expect(isAtSharingCeiling(8)).toBe(true)
    expect(isAtSharingCeiling(9)).toBe(true)
  })

  it("says the mark has stopped moving once the number passes it", () => {
    // Without this the visitor pushes the count to ten, watches a motionless arc and
    // concludes the mark is decorative.
    expect(ceilingCaption(9)).toContain("stopped widening")
    expect(ceilingCaption(3)).not.toContain("stopped widening")
  })

  it("reads correctly in the singular and at zero", () => {
    expect(ceilingCaption(0)).toBe("Only you can open this task.")
    expect(ceilingCaption(1)).toBe("One person can open it, and the ring opens a crack.")
    expect(ceilingCaption(3)).toBe("3 people can open it, and the ring widens with each one.")
    expect(ceilingCaption(10)).toBe("10 people can open it. The ring stopped widening at eight.")
  })
})

describe("reading the ring", () => {
  it("lights private at zero, shared below the ceiling, and the ceiling from eight", () => {
    expect(ringReading(0)).toBe("private")
    for (const n of [1, 3, 7]) expect(ringReading(n)).toBe("shared")
    for (const n of [8, 9, 10, 50]) expect(ringReading(n)).toBe("ceiling")
  })

  it("never reads public, whatever it is given", () => {
    for (const n of [0, 1, 8, 1e9, -1, Number.NaN]) {
      expect(ringReading(n)).not.toBe("public")
    }
  })

  it("says who public reaches, and who it does not", () => {
    // "Public" reads as "the open internet" to most people. In Planora it is every
    // accepted friend, and the sentence has to say the second half out loud.
    expect(ALL_FRIENDS_CAPTION).toContain("All your friends")
    expect(ALL_FRIENDS_CAPTION).toContain("Nobody outside your friends")
  })

  it("tells a screen reader people, not a bare number", () => {
    expect(viewerValueText(0)).toBe("Only you")
    expect(viewerValueText(1)).toBe("1 person")
    expect(viewerValueText(4)).toBe("4 people")
  })

  it("names the count in the ring's centre", () => {
    expect(ringCountNoun(0)).toBe("just you")
    expect(ringCountNoun(1)).toBe("person")
    expect(ringCountNoun(2)).toBe("people")
    expect(ringCountNoun(-3)).toBe("just you")
  })
})
