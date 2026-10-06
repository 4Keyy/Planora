import { describe, expect, it } from "vitest"
import { circleSentence, inSeatOrder, CIRCLE_SEATS, SURPRISE_FOR } from "@/lib/landing-circle"

describe("circleSentence", () => {
  it("starts private", () => {
    expect(circleSentence([])).toBe("Only you can see this.")
  })

  it("names one person", () => {
    expect(circleSentence(["victoria"])).toBe("You and Victoria can see this.")
  })

  it("names two without an Oxford comma", () => {
    expect(circleSentence(["victoria", "tom"])).toBe("You, Victoria and Tom can see this.")
  })

  it("reads in seat order, whatever order the chips were pressed in", () => {
    expect(circleSentence(["tom", "victoria"])).toBe("You, Victoria and Tom can see this.")
    expect(circleSentence(["mira", "tom", "victoria"])).toBe(circleSentence(["victoria", "tom", "mira"]))
  })

  it("gives the surprise away whenever Mira is in", () => {
    expect(circleSentence(["mira"])).toBe("You and Mira can see this. So much for the surprise.")
    expect(circleSentence(["victoria", "tom", "mira"])).toBe(
      "You, Victoria, Tom and Mira can see this. So much for the surprise.",
    )
    expect(circleSentence(["victoria", "tom"])).not.toContain("surprise")
  })
})

describe("the seats", () => {
  it("are Victoria, Tom and Mira, and the surprise is for Mira", () => {
    expect(CIRCLE_SEATS.map((s) => s.firstName)).toEqual(["Victoria", "Tom", "Mira"])
    expect(SURPRISE_FOR).toBe("mira")
  })

  it("filter to the selection in seat order", () => {
    expect(inSeatOrder(["mira", "victoria"]).map((s) => s.id)).toEqual(["victoria", "mira"])
    expect(inSeatOrder([])).toEqual([])
  })
})
