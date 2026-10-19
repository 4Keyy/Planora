import { describe, expect, it } from "vitest"
import {
  COMFORT_ZOOM,
  FIRST_ORBIT,
  MAX_SHARED_FRIENDS,
  MAX_ZOOM,
  MIN_ZOOM,
  ORBIT_GAP,
  RING_SIZE,
  SEAT_SIZE,
  assignSeats,
  audienceSentence,
  clampPan,
  clampZoom,
  firstName,
  firstOrbitRadius,
  fitZoom,
  mapRadius,
  nearestAngle,
  openingZoom,
  orbitLayout,
  orbitSlots,
  personName,
  rankByAffinity,
  seedOf,
  toggleAudience,
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

describe("the circles", () => {
  it("puts at most twelve on the first circle and fills the rest outward, one gap apart", () => {
    expect(orbitLayout(0)).toEqual([])
    expect(orbitLayout(-3)).toEqual([])
    expect(orbitLayout(5)).toEqual([{ radius: FIRST_ORBIT, count: 5 }])
    const orbits = orbitLayout(80)
    expect(orbits[0].count).toBe(MAX_SHARED_FRIENDS)
    expect(orbits.reduce((sum, o) => sum + o.count, 0)).toBe(80)
    for (let i = 1; i < orbits.length; i++) {
      expect(orbits[i].radius - orbits[i - 1].radius).toBeCloseTo(ORBIT_GAP)
      // Wider circles hold more, except the last, which holds whoever is left.
      if (i < orbits.length - 1) expect(orbits[i].count).toBeGreaterThanOrEqual(orbits[i - 1].count)
    }
  })

  it("keeps the first circle clear of the ring, and every seat clear of every other", () => {
    expect(FIRST_ORBIT - SEAT_SIZE / 2).toBeGreaterThan(RING_SIZE / 2 + 24)
    for (const total of [3, 12, 13, 40, 150]) {
      const seats = orbitSlots(total)
      expect(seats).toHaveLength(total)
      let closest = Infinity
      for (let i = 0; i < seats.length; i++) {
        for (let j = i + 1; j < seats.length; j++) {
          closest = Math.min(closest, Math.hypot(seats[i].x - seats[j].x, seats[i].y - seats[j].y))
        }
      }
      // A seat and a short first name beside it.
      expect(closest).toBeGreaterThan(SEAT_SIZE + 20)
    }
  })

  it("sets every seat exactly on its circle, evenly round it, the first up and to the left", () => {
    const slots = orbitSlots(30)
    for (const slot of slots) expect(Math.hypot(slot.x, slot.y)).toBeCloseTo(slot.radius)
    const first = slots.filter((s) => s.orbit === 0)
    const step = first[1].angle - first[0].angle
    for (let i = 1; i < first.length; i++) expect(first[i].angle - first[i - 1].angle).toBeCloseTo(step)
    expect(first[0].x).toBeLessThan(0)
    expect(first[0].y).toBeLessThan(0)
  })

  it("reaches as far as the outermost circle and its names", () => {
    expect(mapRadius(0)).toBe(RING_SIZE / 2)
    const orbits = orbitLayout(40)
    expect(mapRadius(40)).toBe(orbits[orbits.length - 1].radius + SEAT_SIZE / 2 + 22)
    expect(firstOrbitRadius(40)).toBe(orbits[0].radius + SEAT_SIZE / 2 + 22)
    expect(firstOrbitRadius(0)).toBe(RING_SIZE / 2)
  })
})

describe("who sits where", () => {
  const people = Array.from({ length: 20 }, (_, i) => ({ id: `p${i}` }))
  const seated = (chosen: string[]) => assignSeats(people, new Set(chosen))
  const orbitOf = (seats: Map<string, number>, id: string) => orbitSlots(people.length)[seats.get(id) ?? -1].orbit

  it("seats the closest friends on the first circle when nobody is chosen, in ranking order", () => {
    const seats = seated([])
    people.forEach((p, i) => expect(seats.get(p.id)).toBe(i))
  })

  it("brings a friend chosen from far out to the first circle, moving the fewest people", () => {
    const before = seated([])
    const after = seated(["p17"])
    expect(orbitOf(before, "p17")).toBe(1)
    expect(orbitOf(after, "p17")).toBe(0)
    // The least close friend not chosen steps out; the eleven closest keep their seats.
    expect(orbitOf(after, "p11")).toBe(1)
    for (let i = 0; i < 11; i++) expect(after.get(`p${i}`)).toBe(before.get(`p${i}`))
    // Everyone gets exactly one seat.
    expect(new Set(after.values()).size).toBe(people.length)
  })

  it("keeps everyone chosen on the first circle, and the overflow of an older list next", () => {
    const chosen = Array.from({ length: 14 }, (_, i) => `p${19 - i}`)
    const seats = seated(chosen)
    const firstCircle = people.filter((p) => orbitOf(seats, p.id) === 0).map((p) => p.id)
    expect(firstCircle).toHaveLength(MAX_SHARED_FRIENDS)
    for (const id of firstCircle) expect(chosen).toContain(id)
  })

  it("turns the short way round", () => {
    const tau = Math.PI * 2
    expect(nearestAngle(0.1, tau - 0.1)).toBeCloseTo(-0.1)
    expect(nearestAngle(3 * tau + 0.2, 0.3)).toBeCloseTo(3 * tau + 0.3)
    expect(nearestAngle(1, 1)).toBe(1)
  })

  it("gives every id its own stable phase", () => {
    expect(seedOf("ada")).toBe(seedOf("ada"))
    expect(seedOf("ada")).not.toBe(seedOf("tom"))
    for (const id of ["", "a", "a-very-long-friend-id-0123456789"]) {
      expect(seedOf(id)).toBeGreaterThanOrEqual(0)
      expect(seedOf(id)).toBeLessThan(1)
    }
  })
})

describe("the limit", () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `f${i}`)

  it("lets people in and out up to twelve", () => {
    expect(toggleAudience([], "a", false)).toEqual({ ok: true, ids: ["a"] })
    expect(toggleAudience(["a", "b"], "a", false)).toEqual({ ok: true, ids: ["b"] })
    expect(toggleAudience(ids(11), "x", false)).toEqual({ ok: true, ids: [...ids(11), "x"] })
  })

  it("refuses a thirteenth by name", () => {
    expect(toggleAudience(ids(MAX_SHARED_FRIENDS), "x", false)).toEqual({ ok: false })
  })

  it("lets people out of an older, longer list", () => {
    const result = toggleAudience(ids(15), "f0", false)
    expect(result.ok && result.ids).toHaveLength(14)
  })

  it("refuses letting one out of All friends when more than twelve would stay chosen by name", () => {
    expect(toggleAudience(ids(20), "f0", true)).toEqual({ ok: false })
    const result = toggleAudience(ids(13), "f0", true)
    expect(result.ok && result.ids).toHaveLength(12)
  })
})

describe("zoom", () => {
  it("fits everyone, never above 1 and never below the floor", () => {
    expect(fitZoom(360, 300, 80)).toBe(1)
    expect(fitZoom(360, 300, 300)).toBeCloseTo((150 - 12) / 300)
    expect(fitZoom(360, 300, 5000)).toBe(MIN_ZOOM)
    expect(fitZoom(0, 300, 100)).toBe(1)
  })

  it("opens on the whole first circle, everyone if they fit, never above 1 or below legible", () => {
    expect(openingZoom(0.4, 0.75)).toBe(0.75)
    expect(openingZoom(0.95, 0.95)).toBe(0.95)
    expect(openingZoom(1.4, 1.4)).toBe(1)
    expect(openingZoom(0.2, 0.3)).toBe(COMFORT_ZOOM)
    expect(openingZoom(0.9)).toBe(0.9)
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
