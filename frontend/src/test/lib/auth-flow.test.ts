import { describe, expect, it } from "vitest"
import {
  RECOVERY_STEPS,
  RESEND_COOLDOWN_SECONDS,
  cooldownLeft,
  formatCountdown,
  maskEmail,
  recoveryStepFor,
  suggestEmailDomain,
} from "@/lib/auth-flow"

describe("recoveryStepFor", () => {
  it("maps each recovery route to its step", () => {
    expect(recoveryStepFor("/auth/forgot-password")).toBe(1)
    expect(recoveryStepFor("/auth/forgot-password/sent")).toBe(2)
    expect(recoveryStepFor("/auth/reset-password")).toBe(3)
  })

  it("tolerates a trailing slash", () => {
    expect(recoveryStepFor("/auth/forgot-password/")).toBe(1)
    expect(recoveryStepFor("/auth/reset-password//")).toBe(3)
  })

  it("is null everywhere else", () => {
    for (const path of ["/", "/auth/login", "/auth/register", "/auth/verify-email", "/auth", "/dashboard"]) {
      expect(recoveryStepFor(path)).toBeNull()
    }
  })

  it("has four labelled steps", () => {
    expect(RECOVERY_STEPS.map((s) => s.label)).toEqual(["Email", "Inbox", "New password", "Done"])
  })
})

describe("maskEmail", () => {
  it("keeps the first and last letter of the local part", () => {
    expect(maskEmail("alex.morgan@gmail.com")).toBe("a•••n@gmail.com")
  })

  it("shows only the first letter of a short local part", () => {
    expect(maskEmail("al@x.io")).toBe("a•••@x.io")
    expect(maskEmail("a@x.io")).toBe("a•••@x.io")
  })

  it("returns anything that is not an address unchanged", () => {
    expect(maskEmail("not-an-email")).toBe("not-an-email")
    expect(maskEmail("@gmail.com")).toBe("@gmail.com")
    expect(maskEmail("alex@")).toBe("alex@")
  })
})

describe("suggestEmailDomain", () => {
  it.each([
    ["gmial.com", "gmail.com"],
    ["gmai.com", "gmail.com"],
    ["gamil.com", "gmail.com"],
    ["gmal.com", "gmail.com"],
    ["gmail.co", "gmail.com"],
    ["gmail.cm", "gmail.com"],
    ["hotmial.com", "hotmail.com"],
    ["hotmal.com", "hotmail.com"],
    ["hotmail.co", "hotmail.com"],
    ["yahooo.com", "yahoo.com"],
    ["yaho.com", "yahoo.com"],
    ["yahoo.co", "yahoo.com"],
    ["outlok.com", "outlook.com"],
    ["outloo.com", "outlook.com"],
    ["outlook.co", "outlook.com"],
    ["iclod.com", "icloud.com"],
    ["icoud.com", "icloud.com"],
    ["icloud.co", "icloud.com"],
    ["yandex.ri", "yandex.ru"],
    ["mail.ri", "mail.ru"],
  ])("corrects %s to %s", (typo, fixed) => {
    expect(suggestEmailDomain(`alex@${typo}`)).toBe(`alex@${fixed}`)
  })

  it("is case-insensitive about the domain and keeps the local part exactly", () => {
    expect(suggestEmailDomain("Alex.Morgan@GMIAL.COM")).toBe("Alex.Morgan@gmail.com")
    expect(suggestEmailDomain("  alex@gmial.com  ")).toBe("alex@gmail.com")
  })

  it("leaves correct and unknown domains alone", () => {
    expect(suggestEmailDomain("alex@gmail.com")).toBeNull()
    expect(suggestEmailDomain("alex@planora.app")).toBeNull()
    expect(suggestEmailDomain("alex")).toBeNull()
    expect(suggestEmailDomain("alex@")).toBeNull()
    expect(suggestEmailDomain("")).toBeNull()
  })
})

describe("formatCountdown", () => {
  it("formats minutes and zero-padded seconds", () => {
    expect(formatCountdown(42)).toBe("0:42")
    expect(formatCountdown(60)).toBe("1:00")
    expect(formatCountdown(5)).toBe("0:05")
  })

  it("never shows a negative or fractional count", () => {
    expect(formatCountdown(-3)).toBe("0:00")
    expect(formatCountdown(4.2)).toBe("0:05")
  })
})

describe("cooldownLeft", () => {
  it("counts down from the moment the link was sent", () => {
    expect(cooldownLeft(1_000_000, 1_000_000)).toBe(RESEND_COOLDOWN_SECONDS)
    expect(cooldownLeft(1_000_000, 1_018_500)).toBe(42)
    expect(cooldownLeft(1_000_000, 1_000_000 + RESEND_COOLDOWN_SECONDS * 1000)).toBe(0)
  })

  it("is zero without a send time and never exceeds the cooldown", () => {
    expect(cooldownLeft(null, 5)).toBe(0)
    expect(cooldownLeft(Number.NaN, 5)).toBe(0)
    // A clock that moved backwards must not produce a longer wait than the rule.
    expect(cooldownLeft(10_000, 0)).toBe(RESEND_COOLDOWN_SECONDS)
  })
})
