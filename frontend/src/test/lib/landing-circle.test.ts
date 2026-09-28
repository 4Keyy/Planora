import { describe, expect, it } from "vitest"
import { circleSentence, inSeatOrder, CIRCLE_SEATS, SURPRISE_FOR } from "@/lib/landing-circle"

describe("circleSentence", () => {
  it("starts private", () => {
    expect(circleSentence([])).toBe("Only you can see this.")
  })

  it("names one person", () => {
    expect(circleSentence(["dana"])).toBe("You and Dana can see this.")
  })

  it("names two without an Oxford comma", () => {
    expect(circleSentence(["dana", "tom"])).toBe("You, Dana and Tom can see this.")
  })

  it("reads in seat order, whatever order the chips were pressed in", () => {
    expect(circleSentence(["tom", "dana"])).toBe("You, Dana and Tom can see this.")
    expect(circleSentence(["mira", "tom", "dana"])).toBe(circleSentence(["dana", "tom", "mira"]))
  })

  it("gives the surprise away whenever Mira is in", () => {
    expect(circleSentence(["mira"])).toBe("You and Mira can see this. So much for the surprise.")
    expect(circleSentence(["dana", "tom", "mira"])).toBe(
      "You, Dana, Tom and Mira can see this. So much for the surprise.",
    )
    expect(circleSentence(["dana", "tom"])).not.toContain("surprise")
  })
})

describe("the seats", () => {
  it("are Dana, Tom and Mira, and the surprise is for Mira", () => {
    expect(CIRCLE_SEATS.map((s) => s.firstName)).toEqual(["Dana", "Tom", "Mira"])
    expect(SURPRISE_FOR).toBe("mira")
  })

  it("filter to the selection in seat order", () => {
    expect(inSeatOrder(["mira", "dana"]).map((s) => s.id)).toEqual(["dana", "mira"])
    expect(inSeatOrder([])).toEqual([])
  })
})
