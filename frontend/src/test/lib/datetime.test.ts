import { describe, expect, it } from "vitest"
import { UI_LOCALE, formatDate, formatDateLong, formatDateTime } from "@/lib/datetime"

/**
 * The point of this module is that its output does NOT depend on the host, so the
 * assertions below are literal strings rather than values re-derived from
 * `toLocaleDateString()`. A test that re-derives them would keep passing if the
 * locale pinning were removed — which is the exact regression being guarded.
 */

const ISO = "2026-09-13T09:41:00.000Z"

describe("UI_LOCALE", () => {
  it("is the language the document declares", () => {
    // `<html lang="en">` in app/layout.tsx. If one changes, so must the other.
    expect(UI_LOCALE).toBe("en-US")
  })
})

describe("formatDate()", () => {
  it("renders a short, unambiguous calendar date", () => {
    expect(formatDate(ISO)).toBe("Sep 13, 2026")
  })

  it("does not vary with the host locale", () => {
    const before = formatDate(ISO)
    const restore = process.env.LANG
    process.env.LANG = "ru_RU.UTF-8"
    expect(formatDate(ISO)).toBe(before)
    process.env.LANG = restore
  })

  it("renders an em dash for nothing at all", () => {
    expect(formatDate(null)).toBe("—")
    expect(formatDate(undefined)).toBe("—")
    expect(formatDate("")).toBe("—")
  })

  it("renders an em dash rather than 'Invalid Date' for junk", () => {
    expect(formatDate("not-a-date")).toBe("—")
  })
})

describe("formatDateLong()", () => {
  it("spells the month out", () => {
    expect(formatDateLong(ISO)).toBe("September 13, 2026")
  })

  it("guards the same empty and invalid inputs", () => {
    expect(formatDateLong(null)).toBe("—")
    expect(formatDateLong("nonsense")).toBe("—")
  })
})

describe("formatDateTime()", () => {
  it("includes the time to the minute", () => {
    expect(formatDateTime(ISO)).toMatch(/^Sep 13, 2026, \d{2}:\d{2}(\s?[AP]M)?$/)
  })

  it("guards the same empty and invalid inputs", () => {
    expect(formatDateTime(null)).toBe("—")
    expect(formatDateTime("nonsense")).toBe("—")
  })
})
