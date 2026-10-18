import { describe, expect, it } from "vitest"
import {
  cookieNames,
  formatMs,
  formatSpan,
  secondsLeft,
  toBase64Url,
  toHex,
  truncateMiddle,
  uniqueOrigins,
} from "@/lib/landing-trust"

const PAGE = "https://planora.app"
const API = "https://api.planora.app"

describe("uniqueOrigins", () => {
  it("lists this site first and the API second, deduplicated", () => {
    const rows = uniqueOrigins(
      [`${PAGE}/`, `${PAGE}/_next/static/a.js`, `${API}/todos`, `${API}/auth/refresh`, "/relative.css"],
      PAGE,
      API,
    )
    expect(rows).toEqual([
      { origin: PAGE, label: "This site" },
      { origin: API, label: "Planora's API" },
    ])
  })

  it("never hides an origin it does not recognise", () => {
    const rows = uniqueOrigins([`${PAGE}/`, "https://z.example/x", "https://a.example/y"], PAGE, API)
    expect(rows.map((r) => r.origin)).toEqual([PAGE, "https://a.example", "https://z.example"])
    expect(rows[1].label).toBeNull()
  })

  it("ignores non-web schemes and garbage", () => {
    const rows = uniqueOrigins(["data:image/png;base64,AAA", "blob:https://x/1", "::::", `${PAGE}/`], PAGE)
    expect(rows).toEqual([{ origin: PAGE, label: "This site" }])
  })

  it("does not label the API twice when it is the same origin", () => {
    expect(uniqueOrigins([`${PAGE}/api`], PAGE, PAGE)).toEqual([{ origin: PAGE, label: "This site" }])
  })
})

describe("cookieNames", () => {
  it("returns names only, never values", () => {
    expect(cookieNames("XSRF-TOKEN=abc123; theme=light")).toEqual(["XSRF-TOKEN", "theme"])
  })

  it("handles empty, spaced and repeated input", () => {
    expect(cookieNames("")).toEqual([])
    expect(cookieNames(" a=1 ;a=2; b= ")).toEqual(["a", "b"])
  })
})

describe("encoding", () => {
  it("writes hex with leading zeros", () => {
    expect(toHex(new Uint8Array([0, 15, 255]))).toBe("000fff")
  })

  it("writes URL-safe base64 without padding", () => {
    expect(toBase64Url(new Uint8Array([251, 255, 191]))).toBe("-_-_")
    expect(toBase64Url(new Uint8Array([1]))).toBe("AQ")
  })

  it("keeps both ends of a long string", () => {
    expect(truncateMiddle("abcdefghijklmnop", 3)).toBe("abc…nop")
    expect(truncateMiddle("short", 3)).toBe("short")
    expect(truncateMiddle("anything", 0)).toBe("anything")
  })
})

describe("time", () => {
  it("formats whole milliseconds and refuses nonsense", () => {
    expect(formatMs(163.6)).toBe("164")
    expect(formatMs(Number.NaN)).toBe("0")
    expect(formatMs(-5)).toBe("0")
  })

  it("counts a window down in whole seconds, never below zero", () => {
    expect(secondsLeft(5000, 0)).toBe(5)
    expect(secondsLeft(5000, 1)).toBe(5)
    expect(secondsLeft(5000, 4001)).toBe(1)
    expect(secondsLeft(5000, 5000)).toBe(0)
    expect(secondsLeft(5000, 9000)).toBe(0)
  })
})

describe("formatSpan", () => {
  it("says a long span in words, with one decimal while it is small", () => {
    expect(formatSpan(3.4 * 3600_000)).toBe("about 3.4 hours")
    expect(formatSpan(45 * 60_000)).toBe("about 45 minutes")
    expect(formatSpan(12.6 * 24 * 3600_000)).toBe("about 13 days")
    expect(formatSpan(2 * 365 * 24 * 3600_000)).toBe("about 2 years")
    expect(formatSpan(1000)).toBe("about 1 second")
    expect(formatSpan(1234 * 365 * 24 * 3600_000)).toBe("about 1,234 years")
  })

  it("refuses nonsense and tiny spans", () => {
    expect(formatSpan(Number.NaN)).toBe("under a second")
    expect(formatSpan(-1)).toBe("under a second")
    expect(formatSpan(999)).toBe("under a second")
  })
})
