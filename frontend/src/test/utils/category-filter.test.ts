import { beforeEach, describe, expect, it, vi } from "vitest"
import { readFilter, readHintSeen, writeFilter, writeHintSeen } from "@/utils/category-filter"

describe("category filter persistence", () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it("returns an empty filter when nothing has been saved", () => {
    expect(readFilter()).toEqual([])
  })

  it("persists and reads selected category ids", () => {
    writeFilter(["cat-1", "cat-2"])

    expect(readFilter()).toEqual(["cat-1", "cat-2"])
  })

  it("removes the stored filter when no ids are selected", () => {
    writeFilter(["cat-1"])
    writeFilter([])

    expect(readFilter()).toEqual([])
    expect(localStorage.getItem("todos-cat-filter")).toBeNull()
  })

  it("falls back safely when the stored filter is malformed", () => {
    localStorage.setItem("todos-cat-filter", "{bad-json")

    expect(readFilter()).toEqual([])
  })

  it("falls back when the stored filter is not an array or storage throws", () => {
    localStorage.setItem("todos-cat-filter", JSON.stringify({ id: "cat-1" }))
    expect(readFilter()).toEqual([])

    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage unavailable")
    })

    expect(readFilter()).toEqual([])
    expect(readHintSeen()).toBe(false)
  })

  it("tracks whether the category hint has been seen", () => {
    expect(readHintSeen()).toBe(false)

    writeHintSeen()

    expect(readHintSeen()).toBe(true)
  })

  it("ignores write failures so filtering never breaks rendering", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded")
    })

    expect(() => writeFilter(["cat-1"])).not.toThrow()
    expect(() => writeHintSeen()).not.toThrow()
  })
})
