import { describe, expect, it } from "vitest"
import { legendKeyFor, ROW_KEYS } from "@/lib/landing-keys"

describe("legendKeyFor", () => {
  it("maps movement, including Shift's capital letters and the arrows", () => {
    for (const key of ["j", "J", "k", "K", "ArrowDown", "ArrowUp"]) {
      expect(legendKeyFor({ key }), key).toBe("J K")
    }
  })

  it("maps each row action to its legend row", () => {
    expect(legendKeyFor({ key: "Enter" })).toBe("⏎")
    expect(legendKeyFor({ key: "e" })).toBe("E")
    expect(legendKeyFor({ key: "E" })).toBe("E")
    expect(legendKeyFor({ key: " " })).toBe("Space")
    for (const key of ["1", "2", "3", "4", "5"]) expect(legendKeyFor({ key })).toBe("1–5")
    expect(legendKeyFor({ key: "Delete" })).toBe("Delete")
    expect(legendKeyFor({ key: "Backspace" })).toBe("Delete")
    expect(legendKeyFor({ key: "?" })).toBe("?")
  })

  it("lights the palette only for the modified K", () => {
    expect(legendKeyFor({ key: "k", metaKey: true })).toBe("Mod K")
    expect(legendKeyFor({ key: "k", ctrlKey: true })).toBe("Mod K")
    expect(legendKeyFor({ key: "K", ctrlKey: true })).toBe("Mod K")
    // A bare k is movement, not the palette.
    expect(legendKeyFor({ key: "k" })).toBe("J K")
  })

  it("leaves every other modified key to the browser", () => {
    expect(legendKeyFor({ key: "j", ctrlKey: true })).toBeNull()
    expect(legendKeyFor({ key: "Enter", metaKey: true })).toBeNull()
    expect(legendKeyFor({ key: "k", metaKey: true, altKey: true })).toBeNull()
    expect(legendKeyFor({ key: "e", altKey: true })).toBeNull()
  })

  it("ignores keys the page does not bind", () => {
    for (const key of ["6", "0", "x", "a", "Tab", "Escape", "Shift", "g"]) {
      expect(legendKeyFor({ key }), key).toBeNull()
    }
  })

  it("marks exactly the row actions as needing a shown cursor", () => {
    expect([...ROW_KEYS].sort()).toEqual(["1–5", "Delete", "E", "Space", "⏎"].sort())
  })
})
