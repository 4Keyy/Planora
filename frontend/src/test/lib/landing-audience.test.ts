import { describe, expect, it } from "vitest"
import {
  ceilingCaption,
  deriveAudience,
  isAtSharingCeiling,
  normalizeViewerCount,
  SHARING_CEILING,
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

  it("never returns public, because the product cannot produce it", () => {
    // The editor writes isPublic:false on every save and no route serves a task to an
    // anonymous reader, so a `public` arc on the landing page would be a plain lie.
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
    expect(ceilingCaption(0)).toContain("only person")
    expect(ceilingCaption(1)).toContain("One person")
  })
})
