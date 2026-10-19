/**
 * The geometry and the words of the audience map — the panel where a task's owner chooses who
 * can see it, drawn the way the landing page's first block draws its circle: you in the ring at
 * the centre, everyone you could share with on a seat around you.
 *
 * Kept free of React so the parts that can be wrong in an interesting way are testable: who sits
 * closest, how the seats are spread, how far the view starts zoomed out, and the sentence.
 */

/** One friend's closeness, as `GET /todos/api/v1/todos/friend-affinity` reports it. */
export interface FriendAffinity {
  friendId: string
  score: number
  sharedByMe: number
  sharedWithMe: number
}

export interface MapPerson {
  id: string
  firstName?: string | null
  lastName?: string | null
  email?: string | null
}

/** The ring "you" sit in, a seat, and the room a seat's name takes under it — all in px. */
export const RING_SIZE = 104
export const SEAT_SIZE = 44
export const LABEL_ROOM = 22

/**
 * The most friends one task can be shared with person by person — the server's
 * `TodoItem.MaxSharedUsers`. "All friends" is not counted against it.
 */
export const MAX_SHARED_FRIENDS = 12

/** The innermost circle never comes closer to the ring than a seat and a clear gap. */
export const FIRST_ORBIT = RING_SIZE / 2 + SEAT_SIZE / 2 + 30
/** Arc between two neighbouring seats on a circle: a seat and a first name side by side. */
export const SEAT_PITCH = 72
/** Between two circles: a seat, the name under it, and air. */
export const ORBIT_GAP = 80

/** The closest seat sits up and to the left, where the landing's first seat sits. */
const START_ANGLE = (-5 / 6) * Math.PI
const TAU = Math.PI * 2

export interface Orbit {
  /** px from the centre. */
  radius: number
  /** Seats on this circle. */
  count: number
}

/**
 * The circles for `total` people. The first holds the people chosen and, around them, the
 * closest of the rest — never more than `MAX_SHARED_FRIENDS`, so everyone chosen always fits
 * on it. Every circle further out is one `ORBIT_GAP` wider and holds as many seats as its
 * length gives room for, so the structure depends on how many friends there are and nothing
 * else: choosing someone only changes who sits where.
 */
export function orbitLayout(total: number): Orbit[] {
  let left = Math.max(0, Math.floor(total))
  if (left === 0) return []
  const firstCount = Math.min(MAX_SHARED_FRIENDS, left)
  const orbits: Orbit[] = [{ radius: Math.max(FIRST_ORBIT, (firstCount * SEAT_PITCH) / TAU), count: firstCount }]
  left -= firstCount
  while (left > 0) {
    const radius = orbits[orbits.length - 1].radius + ORBIT_GAP
    const count = Math.min(left, Math.max(1, Math.floor((TAU * radius) / SEAT_PITCH)))
    orbits.push({ radius, count })
    left -= count
  }
  return orbits
}

export interface Slot {
  /** Which circle, 0 being the first. */
  orbit: number
  radius: number
  /** Radians, clockwise from the right, as screen coordinates have it. */
  angle: number
  x: number
  y: number
}

/**
 * Every seat's place, circle by circle, evenly around each one. Every other circle is turned
 * half a step, so the seats of neighbouring circles sit between each other, not behind.
 */
export function orbitSlots(total: number): Slot[] {
  const slots: Slot[] = []
  orbitLayout(total).forEach(({ radius, count }, orbit) => {
    const step = TAU / count
    const turn = orbit % 2 === 1 ? step / 2 : 0
    for (let i = 0; i < count; i++) {
      const angle = START_ANGLE + turn + i * step
      slots.push({ orbit, radius, angle, x: radius * Math.cos(angle), y: radius * Math.sin(angle) })
    }
  })
  return slots
}

/**
 * Who sits on which seat, as indexes into `orbitSlots(ranked.length)`.
 *
 * The people chosen go to the first circle, then the closest of the rest fill it, and the rest
 * fill the circles outward. Within a circle the order is the ranking, so choosing somebody from
 * far out moves the fewest people: they take the first circle's last place by rank, the least
 * close friend not chosen there steps out to the next circle, and everyone between shifts by
 * one seat — the room opening for them.
 */
export function assignSeats(ranked: readonly { id: string }[], chosen: ReadonlySet<string>): Map<string, number> {
  const rank = new Map(ranked.map((p, i) => [p.id, i]))
  const queue = [...ranked.filter((p) => chosen.has(p.id)), ...ranked.filter((p) => !chosen.has(p.id))]
  const seats = new Map<string, number>()
  let index = 0
  for (const { count } of orbitLayout(ranked.length)) {
    const circle = queue.slice(index, index + count).sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0))
    circle.forEach((p, i) => seats.set(p.id, index + i))
    index += count
  }
  return seats
}

export function personName(person: MapPerson): string {
  const full = [person.firstName, person.lastName].filter(Boolean).join(" ").trim()
  return full || person.email?.split("@")[0] || "Friend"
}

export function firstName(person: MapPerson): string {
  return person.firstName?.trim() || personName(person).split(" ")[0]
}

/**
 * Closest first: the friends you share the most with, both ways and most recently, then the
 * ones with more shared tasks at all, then by name — so a friend with no history still has a
 * stable place, and two equal friends never swap seats between openings.
 */
export function rankByAffinity<T extends MapPerson>(people: readonly T[], affinity: ReadonlyMap<string, FriendAffinity>): T[] {
  const score = (p: T) => affinity.get(p.id)?.score ?? 0
  const count = (p: T) => {
    const a = affinity.get(p.id)
    return a ? a.sharedByMe + a.sharedWithMe : 0
  }
  return [...people].sort((a, b) =>
    score(b) - score(a) ||
    count(b) - count(a) ||
    personName(a).localeCompare(personName(b), "en", { sensitivity: "base" }) ||
    a.id.localeCompare(b.id),
  )
}

/** How far the drawing reaches from the centre: the outermost circle with its names, or the ring. */
export function mapRadius(count: number): number {
  const orbits = orbitLayout(count)
  if (orbits.length === 0) return RING_SIZE / 2
  return orbits[orbits.length - 1].radius + SEAT_SIZE / 2 + LABEL_ROOM
}

/**
 * The shortest way round from `from` to `to`: `to`, plus or minus whole turns. A seat moving to
 * a new place glides along the circle the short way, never the long way round through the ring.
 */
export function nearestAngle(from: number, to: number): number {
  return to + TAU * Math.round((from - to) / TAU)
}

/** A stable number in [0, 1) for an id: each seat's own phase, the same on every render. */
export function seedOf(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967296
}

export const MIN_ZOOM = 0.3
export const MAX_ZOOM = 1.75

export function clampZoom(scale: number, min = MIN_ZOOM): number {
  if (!Number.isFinite(scale)) return 1
  return Math.min(MAX_ZOOM, Math.max(min, scale))
}

/**
 * The zoom a map opens at: everyone, if they fit; otherwise the whole first circle — the people
 * chosen and the closest of the rest, with their names — and never blown up past 1 or shrunk
 * below the point where names stop being words. The outer circles are a wheel or "show
 * everyone" away.
 */
export const COMFORT_ZOOM = 0.6

export function openingZoom(fit: number, firstFit = fit): number {
  return Math.min(1, Math.max(fit, firstFit, COMFORT_ZOOM))
}

/** How far the first circle reaches, with its names: what the opening view must show. */
export function firstOrbitRadius(count: number): number {
  const [first] = orbitLayout(count)
  return first ? first.radius + SEAT_SIZE / 2 + LABEL_ROOM : RING_SIZE / 2
}

/**
 * The zoom that shows everyone at once in a `width × height` view, never above 1 (a few friends
 * are not blown up) and never below the floor (a long list is zoomed into, not shrunk to dots).
 */
export function fitZoom(width: number, height: number, radius: number, padding = 12): number {
  if (width <= 0 || height <= 0 || radius <= 0) return 1
  const room = Math.min(width, height) / 2 - padding
  return clampZoom(Math.min(1, room / radius))
}

/**
 * The view after zooming by `factor` around the point `(px, py)` of the view (px from its centre):
 * the world point under the pointer stays under the pointer.
 */
export function zoomAround(
  view: { x: number; y: number; scale: number },
  factor: number,
  px: number,
  py: number,
  min = MIN_ZOOM,
): { x: number; y: number; scale: number } {
  const scale = clampZoom(view.scale * factor, min)
  const k = scale / view.scale
  return { scale, x: px - (px - view.x) * k, y: py - (py - view.y) * k }
}

/**
 * Keeps the drawing from being dragged out of sight: the centre of the map may move at most as
 * far as the drawing reaches, so some of it always stays in the view.
 */
export function clampPan(view: { x: number; y: number; scale: number }, radius: number, width: number, height: number) {
  const limitX = Math.max(0, radius * view.scale - width / 4)
  const limitY = Math.max(0, radius * view.scale - height / 4)
  return {
    scale: view.scale,
    x: Math.min(limitX, Math.max(-limitX, view.x)),
    y: Math.min(limitY, Math.max(-limitY, view.y)),
  }
}

export type AudienceToggle = { ok: true; ids: string[] } | { ok: false }

/**
 * Pressing a person: in if they were out, out if they were in — unless that would leave more
 * than `MAX_SHARED_FRIENDS` people chosen by name. Adding a thirteenth is refused, and so is
 * letting one person out of All friends when everyone left would still be more than twelve:
 * that would turn "all friends" into a list the server will not take. Letting people out of an
 * older, longer list is always allowed — it only moves it towards the limit.
 */
export function toggleAudience(inIds: readonly string[], id: string, allFriends: boolean): AudienceToggle {
  const ids = inIds.includes(id) ? inIds.filter((x) => x !== id) : [...inIds, id]
  const grows = ids.length > inIds.length
  if (ids.length > MAX_SHARED_FRIENDS && (grows || allFriends)) return { ok: false }
  return { ok: true, ids }
}

/** "You", "You and Ada", "You, Ada and Tom", "You, Ada, Tom and 3 others" — the landing's words. */
export function audienceSentence(names: readonly string[], allFriends = false): string {
  if (allFriends) return "All your friends can see this."
  if (names.length === 0) return "Only you can see this."
  const shown = names.length > 3 ? names.slice(0, 2) : [...names]
  const rest = names.length - shown.length
  const all = ["You", ...shown, ...(rest > 0 ? [`${rest} ${rest === 1 ? "other" : "others"}`] : [])]
  return `${all.slice(0, -1).join(", ")} and ${all[all.length - 1]} can see this.`
}
