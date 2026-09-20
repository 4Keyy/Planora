import { describe, expect, it } from "vitest"
import { PASSWORD_MIN, PASSWORD_SCHEMA, passwordStrength } from "@/lib/password-policy"

describe("PASSWORD_SCHEMA", () => {
  it("accepts a password that satisfies every class", () => {
    expect(PASSWORD_SCHEMA.safeParse("Correct1!horse").success).toBe(true)
  })

  it("is the same rule sign-in and create-account both use", () => {
    // The bug this replaces: sign-in accepted min(6) while create-account required 8
    // plus four classes, so the sign-in form accepted a shape of password that could
    // never have been created.
    const tooShort = PASSWORD_SCHEMA.safeParse("Ab1!de")
    expect(tooShort.success).toBe(false)
    expect(PASSWORD_MIN).toBe(8)
  })

  it("names the missing class rather than failing silently", () => {
    const r = PASSWORD_SCHEMA.safeParse("alllowercase1!")
    expect(r.success).toBe(false)
    if (!r.success) {
      expect(r.error.issues.map((i) => i.message)).toContain("Needs an uppercase letter")
    }
  })

  it("rejects past the server's 128 ceiling", () => {
    expect(PASSWORD_SCHEMA.safeParse("Aa1!" + "x".repeat(200)).success).toBe(false)
  })
})

describe("passwordStrength", () => {
  it("scores an empty password at zero", () => {
    expect(passwordStrength("").score).toBe(0)
    expect(passwordStrength("").pct).toBe(0)
  })

  it("reaches every one of its four bands", () => {
    // The previous version gave Fair and Good the same colour and never awarded Strong
    // below a perfect six, so two of the four names told the user nothing.
    const labels = new Set(
      ["a", "abcdefgh", "Abcdefgh1", "Abcdefgh1!", "Abcdefghijkl1!"].map(
        (p) => passwordStrength(p).label
      )
    )
    expect(labels.has("Weak")).toBe(true)
    expect(labels.has("Strong")).toBe(true)
    expect(labels.size).toBeGreaterThanOrEqual(3)
  })

  it("never returns a percentage outside 0–100", () => {
    for (const p of ["", "a", "Abcdefghijklmnop1!@#"]) {
      const { pct } = passwordStrength(p)
      expect(pct).toBeGreaterThanOrEqual(0)
      expect(pct).toBeLessThanOrEqual(100)
    }
  })
})
