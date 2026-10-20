import { describe, expect, it } from "vitest"
import { dealColumns, ROW_PX, type DealtCard } from "@/components/ui/masonry-columns"

const HEIGHTS = [120, 80, 160, 48, 96, 72, 200, 64, 112]
const GAP = 16

const MIXED_HEIGHT_DEALS: { columns: number; cards: DealtCard[]; height: number }[] = [
  {
    columns: 1,
    cards: [
      { column: 0, top: 0 }, { column: 0, top: 136 }, { column: 0, top: 232 },
      { column: 0, top: 408 }, { column: 0, top: 472 }, { column: 0, top: 584 },
      { column: 0, top: 672 }, { column: 0, top: 888 }, { column: 0, top: 968 },
    ],
    height: 1080,
  },
  {
    columns: 2,
    cards: [
      { column: 0, top: 0 }, { column: 1, top: 0 }, { column: 1, top: 96 },
      { column: 0, top: 136 }, { column: 0, top: 200 }, { column: 1, top: 272 },
      { column: 0, top: 312 }, { column: 1, top: 360 }, { column: 1, top: 440 },
    ],
    height: 552,
  },
  {
    columns: 3,
    cards: [
      { column: 0, top: 0 }, { column: 1, top: 0 }, { column: 2, top: 0 },
      { column: 1, top: 96 }, { column: 0, top: 136 }, { column: 1, top: 160 },
      { column: 2, top: 176 }, { column: 0, top: 248 }, { column: 1, top: 248 },
    ],
    height: 376,
  },
  {
    columns: 4,
    cards: [
      { column: 0, top: 0 }, { column: 1, top: 0 }, { column: 2, top: 0 },
      { column: 3, top: 0 }, { column: 3, top: 64 }, { column: 1, top: 96 },
      { column: 0, top: 136 }, { column: 1, top: 184 }, { column: 2, top: 176 },
    ],
    height: 336,
  },
  {
    columns: 5,
    cards: [
      { column: 0, top: 0 }, { column: 1, top: 0 }, { column: 2, top: 0 },
      { column: 3, top: 0 }, { column: 4, top: 0 }, { column: 3, top: 64 },
      { column: 1, top: 96 }, { column: 0, top: 136 }, { column: 4, top: 112 },
    ],
    height: 296,
  },
]

describe("golden masonry deals", () => {
  it.each(MIXED_HEIGHT_DEALS)("deals varied heights into $columns columns with a 16px gap", ({ columns, cards, height }) => {
    expect(dealColumns(HEIGHTS, columns, GAP)).toEqual({ cards, height })
    expect(HEIGHTS).toEqual([120, 80, 160, 48, 96, 72, 200, 64, 112])
  })

  it.each([
    { heights: [100, 77, 40], top: 116, column: 0, height: 156, difference: 23 },
    { heights: [100, 76, 40], top: 116, column: 0, height: 156, difference: 24 },
    { heights: [100, 75, 40], top: 91, column: 1, height: 131, difference: 25 },
  ])("uses the leftmost column only within the row tolerance ($difference px)", ({ heights, top, column, height }) => {
    expect(ROW_PX).toBe(24)
    expect(dealColumns(heights, 2, GAP)).toEqual({
      cards: [{ column: 0, top: 0 }, { column: 1, top: 0 }, { column, top }],
      height,
    })
  })

  it("breaks an exact bottom tie to the left", () => {
    expect(dealColumns([64, 64, 64, 64, 64], 3, GAP)).toEqual({
      cards: [
        { column: 0, top: 0 }, { column: 1, top: 0 }, { column: 2, top: 0 },
        { column: 0, top: 80 }, { column: 1, top: 80 },
      ],
      height: 144,
    })
  })

  it("keeps short cards within a row on the left", () => {
    expect(dealColumns([8, 8, 8], 2, GAP)).toEqual({
      cards: [{ column: 0, top: 0 }, { column: 0, top: 24 }, { column: 1, top: 0 }],
      height: 32,
    })
  })

  it.each([1, 2, 3, 4, 5])("returns an empty zero-height grid with %i columns", columns => {
    expect(dealColumns([], columns, GAP)).toEqual({ cards: [], height: 0 })
  })
})
