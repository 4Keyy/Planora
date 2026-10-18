import { describe, expect, it } from "vitest"
import {
  FIRST_ORBIT,
  MAX_ZOOM,
  MIN_ZOOM,
  RING_SIZE,
  SEAT_SIZE,
  audienceSentence,
  clampPan,
  clampZoom,
  firstName,
  fitZoom,
  mapRadius,
  openingZoom,
  orbitRadius,
  personName,
  rankByAffinity,
  seatPositions,
  zoomAround,
  type FriendAffinity,
} from "@/lib/audience-map"

const person = (id: string, first: string, last = "Friend") => ({ id, firstName: first, lastName: last, email: `${id}@x.test` })
const affinity = (entries: FriendAffinity[]) => new Map(entries.map((e) => [e.friendId, e]))

describe("who sits closest", () => {
  it("ranks by score, then by shared tasks, then by name", () => {
    const people = [person("a", "Zoe"), person("b", "Ada"), person("c", "Mia"), person("d", "Ben")]
    const ranked = rankByAffinity(people, affinity([
      { friendId: "a", score: 1.2, sharedByMe: 1, sharedWithMe: 0 },
      { friendId: "c", score: 3.5, sharedByMe: 2, sharedWithMe: 2 },
      { friendId: "d", score: 1.2, sharedByMe: 2, sharedWithMe: 1 },
    ]))
    expect(ranked.map((p) => p.id)).toEqual(["c", "d", "a", "b"])
  })

  it("puts friends with no history in name order, and keeps ties stable", () => {
    const ranked = rankByAffinity([person("2", "ada"), person("1", "Ada"), person("3", "Bob")], new Map())
    expect(ranked.map((p) => p.id)).toEqual(["1", "2", "3"])
  })

  it("does not reorder the list it was given", () => {
    const people = [person("a", "Zoe"), person("b", "Ada")]
    rankByAffinity(people, new Map())
    expect(people.map((p) => p.id)).toEqual(["a", "b"])
  })
})

describe("the spiral", () => {
  it("places seats farther from the centre the further down the ranking they are", () => {
    const seats = seatPositions(60)
    const distances = seats.map((s) => Math.hypot(s.x, s.y))
    for (let i = 1; i < distances.length; i++) expect(distances[i]).toBeGreaterThan(distances[i - 1])
    expect(distances[0]).toBeCloseTo(FIRST_ORBIT)
    expect(distances[59]).toBeCloseTo(orbitRadius(59))
  })

  it("keeps the first seat clear of the ring, and every seat clear of every other", () => {
    expect(FIRST_ORBIT - SEAT_SIZE / 2).toBeGreaterThan(RING_SIZE / 2 + 24)
    const seats = seatPositions(150)
    let closest = Infinity
    for (let i = 0; i < seats.length; i++) {
      for (let j = i + 1; j < seats.length; j++) {
        closest = Math.min(closest, Math.hypot(seats[i].x - seats[j].x, seats[i].y - seats[j].y))
      }
    }
    // A seat and the name under it.
    expect(closest).toBeGreaterThan(SEAT_SIZE + 20)
  })

  it("starts up and to the left, and handles nobody", () => {
    const [first] = seatPositions(1)
    expect(first.x).toBeLessThan(0)
    expect(first.y).toBeLessThan(0)
    expect(seatPositions(0)).toEqual([])
    expect(seatPositions(-3)).toEqual([])
    expect(mapRadius(0)).toBe(RING_SIZE / 2)
    expect(mapRadius(5)).toBeGreaterThan(orbitRadius(4))
  })
})

describe("zoom", () => {
  it("fits everyone, never above 1 and never below the floor", () => {
    expect(fitZoom(360, 300, 80)).toBe(1)
    expect(fitZoom(360, 300, 300)).toBeCloseTo((150 - 12) / 300)
    expect(fitZoom(360, 300, 5000)).toBe(MIN_ZOOM)
    expect(fitZoom(0, 300, 100)).toBe(1)
  })

  it("opens close enough to read names, but never past the fit or above 1", () => {
    expect(openingZoom(0.4)).toBe(0.82)
    expect(openingZoom(0.95)).toBe(0.95)
    expect(openingZoom(1)).toBe(1)
  })

  it("clamps any zoom into range", () => {
    expect(clampZoom(10)).toBe(MAX_ZOOM)
    expect(clampZoom(0.01)).toBe(MIN_ZOOM)
    expect(clampZoom(0.01, 0.1)).toBe(0.1)
    expect(clampZoom(Number.NaN)).toBe(1)
  })

  it("keeps the point under the pointer where it is", () => {
    const view = { x: 20, y: -10, scale: 1 }
    const next = zoomAround(view, 1.5, 60, 40)
    const worldBefore = { x: (60 - view.x) / view.scale, y: (40 - view.y) / view.scale }
    const worldAfter = { x: (60 - next.x) / next.scale, y: (40 - next.y) / next.scale }
    expect(next.scale).toBe(1.5)
    expect(worldAfter.x).toBeCloseTo(worldBefore.x)
    expect(worldAfter.y).toBeCloseTo(worldBefore.y)
    expect(zoomAround({ x: 0, y: 0, scale: MAX_ZOOM }, 2, 10, 10).scale).toBe(MAX_ZOOM)
  })

  it("never lets the drawing be dragged out of sight", () => {
    expect(clampPan({ x: 900, y: -900, scale: 1 }, 200, 360, 300)).toEqual({ scale: 1, x: 110, y: -125 })
    expect(clampPan({ x: 40, y: 40, scale: 0.4 }, 100, 360, 300)).toEqual({ scale: 0.4, x: 0, y: 0 })
  })
})

describe("the sentence", () => {
  it("says who can see the task in the landing's words", () => {
    expect(audienceSentence([])).toBe("Only you can see this.")
    expect(audienceSentence(["Ada"])).toBe("You and Ada can see this.")
    expect(audienceSentence(["Ada", "Tom"])).toBe("You, Ada and Tom can see this.")
    expect(audienceSentence(["Ada", "Tom", "Mia"])).toBe("You, Ada, Tom and Mia can see this.")
    expect(audienceSentence(["Ada", "Tom", "Mia", "Ben"])).toBe("You, Ada, Tom and 2 others can see this.")
    expect(audienceSentence(["Ada"], true)).toBe("All your friends can see this.")
  })

  it("names people by first name, or by what is known of them", () => {
    expect(personName({ id: "1", firstName: "Ada", lastName: "Lovelace" })).toBe("Ada Lovelace")
    expect(personName({ id: "2", email: "grace@x.test" })).toBe("grace")
    expect(personName({ id: "3" })).toBe("Friend")
    expect(firstName({ id: "1", firstName: " Ada ", lastName: "L" })).toBe("Ada")
    expect(firstName({ id: "2", email: "grace@x.test" })).toBe("grace")
  })
})
