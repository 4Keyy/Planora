import { describe, expect, it } from "vitest"
import {
  cookieNames,
  formatMs,
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
