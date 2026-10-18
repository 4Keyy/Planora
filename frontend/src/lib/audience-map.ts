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
/** How far the first, closest seat sits from the centre. */
export const FIRST_ORBIT = RING_SIZE / 2 + SEAT_SIZE / 2 + 30
/**
 * The room each seat is given on the spiral. Every seat gets the same area, so the spiral is as
 * dense at its edge as at its heart, and no two seats come closer than a seat and its name.
 */
export const SEAT_SPACING = 84

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))
/** The closest seat sits up and to the left, where the landing's first seat sits. */
const START_ANGLE = -0.8 * Math.PI

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

/** The distance of the seat at `rank` from the centre: it only ever grows with the rank. */
export function orbitRadius(rank: number): number {
  return Math.sqrt(FIRST_ORBIT ** 2 + (rank * SEAT_SPACING ** 2) / Math.PI)
}

/**
 * Seat centres for `count` people, closest first, in px from the centre of the ring: a sunflower
 * spiral, each seat a golden angle on from the last. Distance grows with the rank and nothing
 * else, so the order of the list is the order of the distances.
 */
export function seatPositions(count: number): { x: number; y: number }[] {
  return Array.from({ length: Math.max(0, count) }, (_, rank) => {
    const r = orbitRadius(rank)
    const angle = START_ANGLE + rank * GOLDEN_ANGLE
    return { x: r * Math.cos(angle), y: r * Math.sin(angle) }
  })
}

/** How far the drawing reaches from the centre: the farthest seat with its name, or the ring. */
export function mapRadius(count: number): number {
  if (count <= 0) return RING_SIZE / 2
  return orbitRadius(count - 1) + SEAT_SIZE / 2 + LABEL_ROOM
}

export const MIN_ZOOM = 0.3
export const MAX_ZOOM = 1.75

export function clampZoom(scale: number, min = MIN_ZOOM): number {
  if (!Number.isFinite(scale)) return 1
  return Math.min(MAX_ZOOM, Math.max(min, scale))
}

/**
 * The zoom a map opens at: close enough that names can be read and the nearest friends are in
 * view, never further out than needed to show everyone, never blown up past 1. The rest of a long
 * list is a wheel or "show everyone" away.
 */
export const COMFORT_ZOOM = 0.82

export function openingZoom(fit: number): number {
  return Math.min(1, Math.max(fit, COMFORT_ZOOM))
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

/** "You", "You and Ada", "You, Ada and Tom", "You, Ada, Tom and 3 others" — the landing's words. */
export function audienceSentence(names: readonly string[], allFriends = false): string {
  if (allFriends) return "All your friends can see this."
  if (names.length === 0) return "Only you can see this."
  const shown = names.length > 3 ? names.slice(0, 2) : [...names]
  const rest = names.length - shown.length
  const all = ["You", ...shown, ...(rest > 0 ? [`${rest} ${rest === 1 ? "other" : "others"}`] : [])]
  return `${all.slice(0, -1).join(", ")} and ${all[all.length - 1]} can see this.`
}
