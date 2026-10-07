import { afterEach, describe, expect, it, vi } from "vitest"
import { readRecent, rememberRecent } from "@/components/command-palette/recent"

afterEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe("palette history", () => {
  it("keeps the latest first, without duplicates, and at most eight", () => {
    for (let i = 0; i < 10; i++) rememberRecent("u1", { kind: "task", id: `t${i}` })
    rememberRecent("u1", { kind: "task", id: "t5" })
    const recent = readRecent("u1")
    expect(recent).toHaveLength(8)
    expect(recent[0]).toEqual({ kind: "task", id: "t5" })
    expect(recent.filter((e) => e.id === "t5")).toHaveLength(1)
  })

  it("is kept per account", () => {
    rememberRecent("u1", { kind: "screen", id: "profile" })
    expect(readRecent("u2")).toEqual([])
    expect(readRecent(null)).toEqual([])
    rememberRecent(undefined, { kind: "screen", id: "profile" })
    expect(window.localStorage.length).toBe(1)
  })

  it("ignores what it did not write", () => {
    window.localStorage.setItem("planora:palette-recent:u1", "{not json")
    expect(readRecent("u1")).toEqual([])
    window.localStorage.setItem("planora:palette-recent:u1", JSON.stringify({ kind: "task" }))
    expect(readRecent("u1")).toEqual([])
    window.localStorage.setItem(
      "planora:palette-recent:u1",
      JSON.stringify([{ kind: "task", id: "ok" }, { kind: "weird", id: "x" }, null, { kind: "task" }]),
    )
    expect(readRecent("u1")).toEqual([{ kind: "task", id: "ok" }])
  })

  it("works without history when storage refuses the write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError")
    })
    expect(() => rememberRecent("u1", { kind: "task", id: "t" })).not.toThrow()
    expect(readRecent("u1")).toEqual([])
  })
})
