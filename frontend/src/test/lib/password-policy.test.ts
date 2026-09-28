import { describe, expect, it } from "vitest"
import { NEW_PASSWORD_SCHEMA, PASSWORD_MIN, PASSWORD_RULES, PASSWORD_SCHEMA, isEasyToGuess } from "@/lib/password-policy"

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

describe("PASSWORD_RULES", () => {
  it("lists the five rules the server checks, in reading order", () => {
    expect(PASSWORD_RULES.map((r) => r.id)).toEqual(["length", "upper", "lower", "number", "symbol"])
    expect(PASSWORD_RULES[0].label).toBe("8 or more characters")
  })

  it("never disagrees with the schema", () => {
    // The checklist is what a person reads while typing; the schema is what refuses the
    // submit. If they ever disagreed, every rule could be ticked and the form still say no.
    const battery = [
      "",
      "a",
      "Ab1!",
      "Ab1!efg",
      "Ab1!efgh",
      "abcdefgh",
      "ABCDEFGH",
      "Abcdefgh",
      "Abcdefg1",
      "abcdefg1!",
      "ABCDEFG1!",
      "Abcdefgh!",
      "Correct1!horse",
      "Пароль1!Aa",
      "Aa1! with spaces",
      "Aa1!" + "x".repeat(124),
      "Aa1!" + "x".repeat(125),
    ]
    for (const value of battery) {
      expect(PASSWORD_SCHEMA.safeParse(value).success, value).toBe(PASSWORD_RULES.every((r) => r.test(value)))
    }
  })
})

describe("isEasyToGuess", () => {
  it("catches what the server refuses when a password is changed", () => {
    // Every one of these ticks all five rules and is still refused as WEAK_PASSWORD.
    for (const value of ["Abcd1234!", "Xy!aaaa9Z", "Password123!", "Welcome!", "WELCOME"]) {
      expect(isEasyToGuess(value), value).toBe(true)
    }
  })

  it("leaves ordinary strong passwords alone", () => {
    for (const value of ["Correct1!horse", "Tr0ub4dor&3", "zX9!qW2@", "Aa1!dcba", "P@ssword1"]) {
      expect(isEasyToGuess(value), value).toBe(false)
    }
  })

  it("is part of the rule for a new password on an existing account only", () => {
    expect(PASSWORD_SCHEMA.safeParse("Abcd1234!").success).toBe(true)
    const r = NEW_PASSWORD_SCHEMA.safeParse("Abcd1234!")
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0].message).toMatch(/Too easy to guess/)
    expect(NEW_PASSWORD_SCHEMA.safeParse("Correct1!horse").success).toBe(true)
  })
})
