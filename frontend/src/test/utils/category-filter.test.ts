import { beforeEach, describe, expect, it, vi } from "vitest"
import { readFilter, readHintSeen, writeFilter, writeHintSeen } from "@/utils/category-filter"

const USER_A = "user-a"
const USER_B = "user-b"

describe("category filter persistence", () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it("returns an empty filter when nothing has been saved", () => {
    expect(readFilter(USER_A)).toEqual([])
  })

  it("persists and reads selected category ids per user", () => {
    writeFilter(USER_A, ["cat-1", "cat-2"])

    expect(readFilter(USER_A)).toEqual(["cat-1", "cat-2"])
  })

  it("never leaks one user's filter onto another account", () => {
    writeFilter(USER_A, ["cat-1", "cat-2"])

    // A different user must not inherit user A's saved filter.
    expect(readFilter(USER_B)).toEqual([])
  })

  it("returns an empty filter when the user is unknown", () => {
    writeFilter(undefined, ["cat-1"])

    expect(readFilter(undefined)).toEqual([])
    expect(readFilter(null)).toEqual([])
  })

  it("removes the stored filter when no ids are selected", () => {
    writeFilter(USER_A, ["cat-1"])
    writeFilter(USER_A, [])

    expect(readFilter(USER_A)).toEqual([])
    expect(localStorage.getItem(`todos-cat-filter:${USER_A}`)).toBeNull()
  })

  it("falls back safely when the stored filter is malformed", () => {
    localStorage.setItem(`todos-cat-filter:${USER_A}`, "{bad-json")

    expect(readFilter(USER_A)).toEqual([])
  })

  it("falls back when the stored filter is not an array or storage throws", () => {
    localStorage.setItem(`todos-cat-filter:${USER_A}`, JSON.stringify({ id: "cat-1" }))
    expect(readFilter(USER_A)).toEqual([])

    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage unavailable")
    })

    expect(readFilter(USER_A)).toEqual([])
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

    expect(() => writeFilter(USER_A, ["cat-1"])).not.toThrow()
    expect(() => writeHintSeen()).not.toThrow()
  })
})
