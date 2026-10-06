import type { Audience } from "@/components/ui/redaction-badge"

/**
 * The landing page's audience derivation, kept here rather than in the page so the one
 * part that can be wrong in an interesting way is testable. `src/app/**` is excluded
 * from the coverage gate (`vitest.config.ts`); `src/lib/**` is not.
 *
 * The range is deliberately `private | shared`. Nothing in Planora is public — there is no
 * public link and no publish button, and even a task shared with every friend is a circle
 * the owner chose — so the ring the landing page draws never closes. Over this range the
 * redaction arc is monotone, which is the whole point of showing it.
 */
export function deriveAudience(viewerCount: number): Audience {
  return normalizeViewerCount(viewerCount) === 0 ? "private" : "shared"
}

/**
 * `RedactionBadge` clamps its own count, but the landing page prints the number beside
 * the mark through its own `NumberRoll` (the badge takes no `minDigits`, and 9 → 10
 * without a reserved column is exactly the 0.119 CLS that `minDigits` was built to fix).
 * Both readings have to agree, so the clamp lives in one place.
 */
export function normalizeViewerCount(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
}

/**
 * The cut opens from 16% of the circumference and widens 4.5% per viewer, saturating at
 * 50% — past half a circle the mark stops reading as a ring and starts reading as a
 * bracket. Past the ceiling the arc holds still and only the number climbs.
 *
 * The landing page walks the visitor into that ceiling on purpose. Left to find it by
 * themselves they would push the count to ten, watch a motionless arc, and conclude the
 * mark is decorative.
 */
export const SHARING_CEILING = 8

export function isAtSharingCeiling(viewerCount: number): boolean {
  return normalizeViewerCount(viewerCount) >= SHARING_CEILING
}

/**
 * The block's one live sentence: the gauge's current reading, said once, in words.
 *
 * Past the ceiling the sentence has two jobs, which is why it has two clauses. The count
 * is still true and still moving, and the ring is not — a visitor watching a still arc
 * while the number climbs needs to be told that the stillness is the design.
 *
 * "eight" is spelled out rather than interpolated from `SHARING_CEILING`: a number in the
 * middle of a sentence reads as a count, and this one is a threshold. The ceiling's own
 * test pins the constant at 8, so the word cannot drift from it unnoticed.
 */
export function ceilingCaption(viewerCount: number): string {
  const count = normalizeViewerCount(viewerCount)
  if (count === 0) return "Only you can open this task."
  if (count === 1) return "One person can open it, and the ring opens a crack."
  if (isAtSharingCeiling(count)) {
    return `${count} people can open it. The ring stopped widening at eight.`
  }
  return `${count} people can open it, and the ring widens with each one.`
}

/**
 * Which way of reading the ring applies at this count — the legend row that is lit.
 *
 * The range is three states, not four. The legend's last row, public, says it is not
 * possible, and the type says so here, where a slip would otherwise light it.
 */
export type RingReading = "private" | "shared" | "ceiling"

export function ringReading(viewerCount: number): RingReading {
  const count = normalizeViewerCount(viewerCount)
  if (count === 0) return "private"
  return isAtSharingCeiling(count) ? "ceiling" : "shared"
}

/**
 * The slider's `aria-valuetext`. A bare "0" is what a screen reader says for a range
 * input without one, and zero people is not how anybody describes a private task.
 */
export function viewerValueText(viewerCount: number): string {
  const count = normalizeViewerCount(viewerCount)
  if (count === 0) return "Only you"
  return count === 1 ? "1 person" : `${count} people`
}

/** The word under the count in the ring's centre. At zero there is no count, only you. */
export const RING_COUNT_NOUNS = ["just you", "person", "people"] as const

export type RingCountNoun = (typeof RING_COUNT_NOUNS)[number]

export function ringCountNoun(viewerCount: number): RingCountNoun {
  const count = normalizeViewerCount(viewerCount)
  if (count === 0) return "just you"
  return count === 1 ? "person" : "people"
}
