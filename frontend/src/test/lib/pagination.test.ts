import { describe, expect, it } from "vitest"
import { pageWindow } from "@/lib/pagination"

describe("pageWindow", () => {
  it("shows every page when there are few", () => {
    expect(pageWindow(1, 1)).toEqual([1])
    expect(pageWindow(1, 2)).toEqual([1, 2])
    expect(pageWindow(2, 3)).toEqual([1, 2, 3])
  })

  it("keeps the ends and the current page's neighbours, with gaps between", () => {
    expect(pageWindow(5, 10)).toEqual([1, "gap", 4, 5, 6, "gap", 10])
    expect(pageWindow(1, 10)).toEqual([1, 2, "gap", 10])
    expect(pageWindow(10, 10)).toEqual([1, "gap", 9, 10])
  })

  it("shows a single skipped page instead of a gap marker", () => {
    expect(pageWindow(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(pageWindow(3, 10)).toEqual([1, 2, 3, 4, "gap", 10])
  })

  it("clamps a current page outside the range and handles no pages", () => {
    expect(pageWindow(99, 3)).toEqual([1, 2, 3])
    expect(pageWindow(0, 3)).toEqual([1, 2, 3])
    expect(pageWindow(1, 0)).toEqual([])
  })
})
